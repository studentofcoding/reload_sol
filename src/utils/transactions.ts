import { WalletContextState } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { TokenInfo } from "@/types/token";
import { RateLimiter } from "./rate-limiter";
import { sleep } from "./sleep";
import { NATIVE_MINT } from "@solana/spl-token";
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from "@solana/spl-token";

const rateLimiter = new RateLimiter(10, 1000, 'SwapRateLimiter');

interface AutoSwapResult {
  successfulBuys: string[];
  failedBuys: string[];
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
    priorityFee = 0.0001,
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

  try {
    // First check if ATAs exist for each token and create them if needed
    const ataChecks = await Promise.all(tokenList.map(async (token) => {
      try {
        const ata = await getAssociatedTokenAddress(
          new PublicKey(token.mint),
          wallet.publicKey!
        );
        
        // Check if ATA exists
        const account = await solConnection.getAccountInfo(ata);
        return {
          token,
          ataExists: !!account,
          ata
        };
      } catch (error) {
        console.error(`Error checking ATA for ${token.symbol}:`, error);
        failedTokens.push(token.mint);
        return { token, ataExists: false, ata: null };
      }
    }));
    
    // Create ATAs for tokens that need them
    const tokensNeedingAta = ataChecks.filter(check => !check.ataExists && check.ata);
    
    if (tokensNeedingAta.length > 0) {
      // Create ATAs in batches
      const ataBatchSize = 5;
      for (let i = 0; i < tokensNeedingAta.length; i += ataBatchSize) {
        const batch = tokensNeedingAta.slice(i, i + ataBatchSize);
        const instructions = batch.map(({ token, ata }) => 
          createAssociatedTokenAccountInstruction(
            wallet.publicKey!,
            ata!,
            wallet.publicKey!,
            new PublicKey(token.mint)
          )
        );
        
        // Create and send ATA creation transaction
        // (Implementation depends on your transaction structure)
        // This is a simplified example
        console.log(`Creating ${batch.length} ATAs for tokens`);
        
        // Process ATA creation here...
        // You would need to create a transaction, sign it, and send it
      }
    }
    
    // Continue with the existing swap logic...
    // Process all batches concurrently
    await Promise.all(batches.map(async (batch, batchIndex) => {
      // Process all tokens in the batch concurrently
      const batchPromises = batch.map(async (token) => {
        return rateLimiter.schedule(async () => {
          try {
            // Use the same API endpoint as Swap function
            const response = await fetch("https://swap-v2.solanatracker.io/swap", {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                "Connection": "keep-alive"
              },
              body: JSON.stringify({
                from: token.mint,
                to: NATIVE_MINT.toBase58(),
                amount: amountPerToken,
                slippage: slippage,
                payer: wallet.publicKey?.toBase58(),
                priorityFee: priorityFee,
              }),
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
      
      // No delay between batches to make it faster
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
              result.successfulBuys.push(token.symbol);
              result.totalSpent += amountPerToken;
            }).catch(error => {
              console.error(`Failed to confirm transaction for ${token.symbol}:`, error);
              result.failedBuys.push(token.symbol);
            });
          } catch (error) {
            console.error(`Failed to send transaction for ${token.symbol}:`, error);
            result.failedBuys.push(token.symbol);
          }
        }));
      }
      
      // Wait a moment for confirmations to catch up
      await sleep(1500);
      
    } catch (error) {
      console.error("Failed to sign transactions:", error);
      tokensToProcess.forEach(token => {
        if (!result.failedBuys.includes(token.symbol)) {
          result.failedBuys.push(token.symbol);
        }
      });
    }
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
