import { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, VersionedTransaction, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TokenInfo } from "@/types/token";
import { RateLimiter } from "./rate-limiter";
import { sleep } from "./sleep";
import { NATIVE_MINT } from "@solana/spl-token";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { adminSupabase } from '@/utils/supabase';
import tokenList from '@/components/tokenlist.json';
import { isDevWallet } from '@/config/devWallets';

const rateLimiter = new RateLimiter(20, 1000, 'SwapRateLimiter');

interface AutoSwapResult {
  successfulBuys: string[];
  failedBuys: { mint: string; symbol: string; error: string }[];
  totalSpent: number;
  successfulSignatures: string[];
}

interface AutoSwapOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  amountPerToken?: number;
  slippage?: number;
  priorityFee?: number;
  abortTimeoutMs?: number;
}

interface ReferralInfo {
  walletAddress: string;
  alias: string;
  isActive: boolean;
}

interface CopyTradingOptions {
  maxAmountPerTrade?: number;
  slippage?: number;
  priorityFee?: number;
  mode?: 'sequential' | 'bundle';
}

interface SwapPerformanceMetrics {
  preparationTime: number;
  signingTime: number;
  sendingTime: number;
  confirmationTime: number;
}

export function calculateAutoBuyCost(numTokens: number, amountPerToken: number = 0.1): number {
  // Base cost per token (including slippage and fees)
  const baseCostPerToken = amountPerToken * 1.02; // 2% buffer for slippage and fees
  return numTokens * baseCostPerToken;
}

export async function autoSwapTokens(
  tokenList: TokenInfo[],
  wallet: WalletContextState,
  solConnection: Connection,
  swapState: boolean,
  options: AutoSwapOptions = {}
): Promise<AutoSwapResult> {
  const {
    batchSize = 10,
    delayBetweenBatches = 1500,
    amountPerToken = 0.001,
    slippage = 10,
    priorityFee = 0.00002,
    abortTimeoutMs = 30000
  } = options;

  if (!wallet.publicKey || !wallet.signAllTransactions) {
    throw new Error("Wallet not connected");
  }

  const result: AutoSwapResult = {
    successfulBuys: [],
    failedBuys: [],
    totalSpent: 0,
    successfulSignatures: []
  };

  // Get blockhash once at the start to avoid multiple RPC calls
  const { blockhash, lastValidBlockHeight } = await solConnection.getLatestBlockhash('confirmed');

  // Create batches
  const batches: TokenInfo[][] = [];
  for (let i = 0; i < tokenList.length; i += batchSize) {
    batches.push(tokenList.slice(i, i + batchSize));
  }

  // Prepare all swap transactions
  const swapBundle: VersionedTransaction[] = [];
  const tokensToProcess: TokenInfo[] = [];
  const failedTokens: string[] = [];

  // Set up abort controller for timeouts
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), abortTimeoutMs);

  // Get referral info at the start
  const referralInfo = await getReferralInfo();
  
  try {
    // Process all batches concurrently
    await Promise.all(batches.map(async (batch, batchIndex) => {
      // Process all tokens in the batch concurrently
      const batchPromises = batch.map(async (token) => {
        return rateLimiter.schedule(async () => {
          try {
            // Modify the swap API call to include referral fee
            const swapApiBody = {
              from: token.mint,
              to: NATIVE_MINT.toBase58(),
              amount: amountPerToken,
              slippage: slippage,
              payer: wallet.publicKey?.toBase58(),
              priorityFee: priorityFee,
              fee: referralInfo 
                ? `${referralInfo.walletAddress}:0.3` // 0.3 SOL for referral
                : "3V3N5xh6vUUVU3CnbjMAXoyXendfXzXYKzTVEsFrLkgX:0.3" // Default fee address
            };

            // Use the same API endpoint as Swap function
            const response = await fetch("https://swap-v2.solanatracker.io/swap", {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                "Connection": "keep-alive"
              },
              body: JSON.stringify(swapApiBody),
              signal: controller.signal,
              keepalive: true
            });
            
            if (!response.ok) {
              // Skip this token on 500 error instead of failing the whole batch
              console.warn(`Skipping token ${token.symbol} due to API error: ${response.status}`);
              failedTokens.push(token.mint);
              return { success: false, token };
            }
            
            const swapResponse = await response.json();
            if (!swapResponse.txn) {
              failedTokens.push(token.mint);
              return { success: false, token };
            }
            
            const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.txn, 'base64'));
            // Set blockhash immediately to avoid another RPC call later  
            tx.message.recentBlockhash = blockhash;
            
            swapBundle.push(tx);
            tokensToProcess.push(token);
            return { success: true, token };
          } catch (error) {
            console.error(`Failed to prepare swap for ${token.symbol}:`, error);
            failedTokens.push(token.mint);
            return { success: false, token, error };
          }
        });
      });

      await Promise.all(batchPromises);
    }));
  } finally {
    clearTimeout(timeoutId);
  }

  // If we have transactions to process, sign and send them in batches
  if (swapBundle.length > 0) {
    try {
      // Sign all transactions at once
      const signedSwapBundle = await wallet.signAllTransactions(swapBundle);
      
      // Send transactions in parallel batches of 5 for better performance
      const sendBatchSize = 10;
      for (let i = 0; i < signedSwapBundle.length; i += sendBatchSize) {
        const batchTxs = signedSwapBundle.slice(i, i + sendBatchSize);
        const batchTokens = tokensToProcess.slice(i, i + sendBatchSize);
        
        // Send batch in parallel
        await Promise.all(batchTxs.map(async (tx, idx) => {
          const token = batchTokens[idx];
          try {
            // Send transaction with skipPreflight for better performance
            const signature = await solConnection.sendTransaction(tx, {
              skipPreflight: true,
              maxRetries: 3
            });
            
            // Add to successful list immediately, we'll confirm later
            result.successfulSignatures.push(signature);
            
            // Confirm transaction in background
            solConnection.confirmTransaction({
              signature,
              blockhash,
              lastValidBlockHeight
            }).then(() => {
              result.successfulBuys.push(token.mint);
              result.totalSpent += amountPerToken;
            }).catch(error => {
              console.error(`Failed to confirm transaction for ${token.symbol}:`, error);
              result.failedBuys.push({
                mint: token.mint,
                symbol: token.symbol,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            });
          } catch (error) {
            console.error(`Failed to send transaction for ${token.symbol}:`, error);
            result.failedBuys.push({
              mint: token.mint,
              symbol: token.symbol,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }));
      }
      
      // Wait a moment for confirmations to catch up
      await sleep(1500);
      
    } catch (error) {
      console.error("Failed to sign transactions:", error);
      tokensToProcess.forEach(token => {
        if (!result.failedBuys.some(f => f.mint === token.mint)) {
          result.failedBuys.push({
            mint: token.mint,
            symbol: token.symbol,
            error: 'Failed to sign transaction'
          });
        }
      });
    }
  }

  // Update referral earnings after successful swaps
  if (referralInfo && result.successfulBuys.length > 0) {
    const totalProcessed = result.totalSpent;
    await updateReferralEarnings(
      referralInfo.alias,
      result.successfulBuys.length,
      totalProcessed
    );
  }

  return result;
}

async function prepareSwapTransaction(
  tokenMint: string,
  walletPubkey: PublicKey,
  connection: Connection,
  amount: number,
  slippage: number,
  priorityFee: number,
  blockhash: string,
  signal: AbortSignal
): Promise<VersionedTransaction | null> {
  try {
    const response = await fetch("https://swap-v2.solanatracker.io/swap", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Connection": "keep-alive"
      },
      body: JSON.stringify({
        from: tokenMint,
        to: NATIVE_MINT.toBase58(),
        amount: amount,
        slippage: slippage,
        payer: walletPubkey.toBase58(),
        priorityFee: priorityFee,
      }),
      signal: signal,
      keepalive: true
    });
    
    if (!response.ok) throw new Error(`Swap request failed: ${response.statusText}`);
    
    const swapResponse = await response.json();
    if (!swapResponse.txn) throw new Error("No transaction returned from swap API");
    
    const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.txn, 'base64'));
    // Set blockhash immediately to avoid another RPC call later  
    tx.message.recentBlockhash = blockhash;
    return tx;
  } catch (error) {
    console.error(`Failed to prepare swap transaction:`, error);
    return null;
  }
}

async function getReferralInfo(): Promise<ReferralInfo | null> {
  try {
    // Get referral code from URL
    const urlParams = new URLSearchParams(window.location.search);
    const pathParts = window.location.pathname.split('@');
    const referralCode = pathParts[1] || urlParams.get('with');

    if (!referralCode) return null;

    // Query the referral system
    const { data: referralData, error } = await adminSupabase
      .from('referral_system_reload')
      .select('*')
      .eq('alias', referralCode)
      .eq('is_active', true)
      .single();

    if (error || !referralData) return null;

    return {
      walletAddress: referralData.wallet_address,
      alias: referralData.alias,
      isActive: referralData.is_active
    };
  } catch (error) {
    console.error('Error getting referral info:', error);
    return null;
  }
}

async function updateReferralEarnings(
  referralCode: string, 
  successfulTokenCount: number,
  totalProcessed: number
): Promise<void> {
  try {
    // Calculate referral earnings (10% of total processed amount)
    const earnedAmount = totalProcessed * 0.1; // 10% of total processed
    
    console.log('Updating referral earnings:', {
      referralCode,
      tokensProcessed: successfulTokenCount,
      totalProcessed: totalProcessed,
      earnedAmount: earnedAmount
    });

    const { data: referralData } = await adminSupabase
      .from('referral_system_reload')
      .select('total_earned')
      .eq('alias', referralCode)
      .single();

    if (referralData) {
      await adminSupabase
        .from('referral_system_reload')
        .update({
          total_earned: referralData.total_earned + earnedAmount,
          last_earned_at: new Date().toISOString()
        })
        .eq('alias', referralCode);
    }
  } catch (error) {
    console.error('Error updating referral earnings:', error);
  }
}

export async function createTransactionWithReferral(
  instructions: TransactionInstruction[],
  wallet: PublicKey,
  connection: Connection,
  tokenCount: number
): Promise<TransactionInstruction[]> {
  const referralInfo = await getReferralInfo();
  const devWallet = new PublicKey(process.env.NEXT_PUBLIC_DEV_WALLET!);

  // Calculate total fee for the entire bundle
  const totalFee = tokenCount * 1_000_000; // 0.001 SOL per token

  if (referralInfo) {
    try {
      const referralPubkey = new PublicKey(referralInfo.walletAddress);
      
      // Calculate bundle fees
      const platformFee = Math.floor(totalFee * 0.9); // 90% to platform
      const referralFee = totalFee - platformFee; // Remainder to referrer
      
      // Update referral earnings with total processed amount
      await updateReferralEarnings(
        referralInfo.alias,
        tokenCount,
        totalFee / 1e9 // Convert lamports to SOL
      );

      // Add single platform fee transfer for the bundle
      return [
        ...instructions,
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: devWallet,
          lamports: platformFee
        }),
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: referralPubkey,
          lamports: referralFee
        })
      ];
    } catch (error) {
      console.error('Referral Transaction Error:', error);
      return [
        ...instructions,
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: devWallet,
          lamports: totalFee
        })
      ];
    }
  }

  return [
    ...instructions,
    SystemProgram.transfer({
      fromPubkey: wallet,
      toPubkey: devWallet,
      lamports: totalFee
    })
  ];
}

/**
 * Start copy trading for specified trader addresses
 */
export async function startCopyTrading(
  traderAddresses: string[],
  wallet: WalletContextState,
  connection: Connection,
  options: CopyTradingOptions = {}
): Promise<boolean> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected');
  }

  const {
    maxAmountPerTrade = 0.01,
    slippage = 1.0,
    priorityFee = 0.000005,
    mode = 'sequential'
  } = options;

  try {
    // Store copy trading configuration in localStorage
    const config = {
      active: true,
      traderAddresses,
      maxAmountPerTrade,
      slippage,
      priorityFee,
      mode,
      startTime: Date.now()
    };

    localStorage.setItem(`copy_trading_${wallet.publicKey.toString()}`, JSON.stringify(config));
    
    // In a real implementation, this might also set up a WebSocket connection
    // or register with a backend service to receive trade notifications
    
    return true;
  } catch (error) {
    console.error('Error starting copy trading:', error);
    throw error;
  }
}

/**
 * Stop copy trading for the current wallet
 */
export async function stopCopyTrading(
  walletPublicKey: PublicKey
): Promise<boolean> {
  try {
    // Get current config
    const configStr = localStorage.getItem(`copy_trading_${walletPublicKey.toString()}`);
    if (!configStr) {
      return false; // No active copy trading
    }
    
    const config = JSON.parse(configStr);
    
    // Update config to inactive
    config.active = false;
    config.endTime = Date.now();
    
    localStorage.setItem(`copy_trading_${walletPublicKey.toString()}`, JSON.stringify(config));
    
    // In a real implementation, this would also close WebSocket connections
    // or unregister from backend services
    
    return true;
  } catch (error) {
    console.error('Error stopping copy trading:', error);
    throw error;
  }
}

/**
 * Check if copy trading is active for the current wallet
 */
export function isCopyTradingActive(walletPublicKey: PublicKey | null): boolean {
  if (!walletPublicKey) return false;
  
  try {
    const configStr = localStorage.getItem(`copy_trading_${walletPublicKey.toString()}`);
    if (!configStr) return false;
    
    const config = JSON.parse(configStr);
    return config.active === true;
  } catch (error) {
    console.error('Error checking copy trading status:', error);
    return false;
  }
}

/**
 * Execute a copy trade based on a trader's transaction
 */
export async function executeCopyTrade(
  tokenMint: string,
  isBuy: boolean,
  amount: number,
  wallet: WalletContextState,
  connection: Connection,
  options: CopyTradingOptions = {}
): Promise<string | null> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Wallet not connected');
  }

  const {
    slippage = 1.0,
    priorityFee = 0.000005,
  } = options;

  try {
    // Create a complete TokenInfo object with required properties
    const tokenInfo: TokenInfo = {
      mint: tokenMint,
      symbol: 'UNKNOWN', // Default symbol
      name: 'Unknown Token', // Default name
      id: tokenMint, // Use mint as id
      balance: 0, // Default balance
      price: 0, // Default price
      decimal: 9, // Default decimal (most common for Solana tokens)
      // Add any other required properties with default values
    };

    // For buy operations, use the existing autoSwapTokens function
    if (isBuy) {
      const result = await autoSwapTokens(
        [tokenInfo], // Complete TokenInfo object
        wallet,
        connection,
        true, // swapState = true for buying
        {
          amountPerToken: amount,
          slippage: slippage,
          priorityFee: priorityFee,
        }
      );
      
      return result.successfulSignatures[0] || null;
    } else {
      // For sell operations, use autoSwapTokens with swapState = false
      const result = await autoSwapTokens(
        [tokenInfo], // Complete TokenInfo object
        wallet,
        connection,
        false, // swapState = false for selling
        {
          amountPerToken: amount,
          slippage: slippage,
          priorityFee: priorityFee,
        }
      );
      
      return result.successfulSignatures[0] || null;
    }
  } catch (error) {
    console.error('Error executing copy trade:', error);
    throw error;
  }
}

/**
 * Auto buy multiple tokens in a single batch for dev wallet
 */
export async function devWalletAutoBuy(
  wallet: WalletContextState,
  connection: Connection,
  options: {
    maxTokens?: number;
    amountPerToken?: number;
    slippage?: number;
    priorityFee?: number;
    concurrentLimit?: number;
  } = {}
): Promise<AutoSwapResult> {
  const {
    maxTokens = 15,
    amountPerToken = 0.0005,
    slippage = 5.0,
    priorityFee = 0.0001,
    concurrentLimit = 20
  } = options;

  // Verify this is the dev wallet using isDevWallet check
  if (!wallet.publicKey || !wallet.signAllTransactions) {
    throw new Error("Wallet not connected");
  }

  if (!isDevWallet(wallet.publicKey.toString())) {
    throw new Error("Unauthorized: Only dev wallet can use this function");
  }

  const result: AutoSwapResult = {
    successfulBuys: [],
    failedBuys: [],
    totalSpent: 0,
    successfulSignatures: []
  };

  const metrics: SwapPerformanceMetrics = {
    preparationTime: 0,
    signingTime: 0,
    sendingTime: 0,
    confirmationTime: 0
  };

  const startTime = performance.now();
  
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const prepStart = performance.now();

    // Prepare all tokens first
    const tokensToProcess = tokenList.tokens
      .slice(0, maxTokens)
      .map(token => ({
        mint: token.mint,
        symbol: token.symbol,
        name: token.name,
        id: token.mint,
        balance: 0,
        price: 0,
        decimal: 9
      }));

    const successfulPreps: {
      token: TokenInfo;
      transaction: VersionedTransaction;
    }[] = [];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      // Send all swap requests simultaneously
      const swapPromises = tokensToProcess.map(async (token) => {
        try {
          const swapBody = {
            from: NATIVE_MINT.toBase58(),
            to: token.mint,
            amount: amountPerToken,
            slippage: slippage,
            payer: wallet.publicKey?.toBase58(),
            priorityFee: priorityFee,
          };

          // Use Promise.all to send request and process response together
          const [response] = await Promise.all([
            fetch("https://swap-v2.solanatracker.io/swap", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Connection": "keep-alive"
              },
              body: JSON.stringify(swapBody),
              signal: controller.signal,
              keepalive: true
            })
          ]);

          if (!response.ok) {
            throw new Error(`Swap API error: ${response.status}`);
          }

          const swapResponse = await response.json();
          if (!swapResponse.txn) {
            throw new Error("No transaction returned from API");
          }

          const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.txn, 'base64'));
          tx.message.recentBlockhash = blockhash;

          return {
            success: true as const,
            token,
            transaction: tx
          };
        } catch (error) {
          console.error(`Failed to prepare swap for ${token.symbol}:`, error);
          return {
            success: false as const,
            token,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      // Wait for all swap requests to complete
      const swapResults = await Promise.all(swapPromises);

      // Process results
      swapResults.forEach(swapResult => {
        if (swapResult.success) {
          successfulPreps.push({
            token: swapResult.token,
            transaction: swapResult.transaction
          });
        } else {
          result.failedBuys.push({
            mint: swapResult.token.mint,
            symbol: swapResult.token.symbol,
            error: swapResult.error
          });
        }
      });

    } finally {
      clearTimeout(timeoutId);
    }

    metrics.preparationTime = performance.now() - prepStart;

    // Process successful preparations with improved batching
    if (successfulPreps.length > 0) {
      console.log(`Signing ${successfulPreps.length} successful transactions...`);
      
      // Sign transactions with performance tracking
      const signStart = performance.now();
      const transactionsToSign = successfulPreps.map(prep => prep.transaction);
      const signedBundle = await wallet.signAllTransactions(transactionsToSign);
      metrics.signingTime = performance.now() - signStart;

      // Send transactions with improved concurrency
      const sendStart = performance.now();
      const sendPromises = signedBundle.map(async (tx, index) => {
        try {
          const signature = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 1,
            preflightCommitment: 'processed' // Use 'processed' instead of 'confirmed' for faster response
          });
          return { 
            success: true, 
            signature,
            token: successfulPreps[index].token 
          };
        } catch (error) {
          return { 
            success: false, 
            error,
            token: successfulPreps[index].token 
          };
        }
      });

      // Process sends in parallel with maximum concurrency
      const signatures = await Promise.all(sendPromises);
      metrics.sendingTime = performance.now() - sendStart;

      // Confirm transactions with WebSocket for better performance
      const confirmStart = performance.now();
      const successfulSignatures = signatures.filter((s): s is { 
        success: true; 
        signature: string; 
        token: TokenInfo;
      } => s.success);

      // Use websocket subscription for faster confirmation
      const confirmations = await Promise.all(
        successfulSignatures.map(async ({ signature, token }) => {
          try {
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Confirmation timeout')), 30000);
              const sub = connection.onSignature(
                signature,
                (result) => {
                  clearTimeout(timeout);
                  if (result.err) reject(result.err);
                  else resolve(result);
                },
                'processed'
              );
            });
            
            result.successfulBuys.push(token.mint);
            result.totalSpent += amountPerToken;
            console.log(`Successfully bought ${token.symbol}`);
            return true;
          } catch (error) {
            console.error(`Failed to confirm ${token.symbol}:`, error);
            result.failedBuys.push({
              mint: token.mint,
              symbol: token.symbol,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            return false;
          }
        })
      );
      metrics.confirmationTime = performance.now() - confirmStart;

      // Add successful signatures to result
      result.successfulSignatures.push(
        ...successfulSignatures
          .filter((_, index) => confirmations[index])
          .map(s => s.signature)
      );
    }

    // Log performance metrics
    const totalTime = performance.now() - startTime;
    console.log('Performance metrics:', {
      ...metrics,
      totalTime,
      successfulTransactions: result.successfulBuys.length,
      failedTransactions: result.failedBuys.length,
      averageTimePerTransaction: totalTime / (result.successfulBuys.length || 1)
    });

    return result;
  } catch (error) {
    console.error('Dev wallet auto-buy failed:', error);
    throw error;
  }
}

// Helper function to use the dev wallet auto-buy
export async function quickAutoBuy(
  wallet: WalletContextState,
  connection: Connection,
  amount: number = 0.001
): Promise<void> {
  try {
    console.log('Starting quick auto-buy...');
    
    const result = await devWalletAutoBuy(wallet, connection, {
      maxTokens: 15,
      amountPerToken: amount,
      slippage: 5.0,
      priorityFee: 0.0001
    });

    console.log('Auto-buy results:', {
      successful: result.successfulBuys.length,
      failed: result.failedBuys.length,
      totalSpent: result.totalSpent,
      signatures: result.successfulSignatures
    });

    // Map successful buys to token symbols for better logging
    const successfulTokens = result.successfulBuys.map(mint => {
      const token = tokenList.tokens.find(t => t.mint === mint);
      return token ? token.symbol : mint;
    });

    console.log('Successfully bought:', successfulTokens.join(', '));
    
    if (result.failedBuys.length > 0) {
      console.log('Failed to buy:', result.failedBuys.map(f => f.symbol).join(', '));
    }
  } catch (error) {
    console.error('Quick auto-buy failed:', error);
    throw error;
  }
}
