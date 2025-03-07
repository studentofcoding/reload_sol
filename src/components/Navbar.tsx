"use client"
import React, { useContext, useEffect, useState } from "react";
import { useWallet, WalletContextState } from "@solana/wallet-adapter-react";
import UserContext from "@/contexts/usercontext";
import { successAlert, warningAlert } from "@/components/Toast";
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction, NATIVE_MINT, getMint, createBurnCheckedInstruction, getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import {
  PublicKey,
  Connection,
  VersionedTransaction,
  TransactionInstruction,
  TransactionMessage,
  ComputeBudgetProgram,
  SystemProgram,
  Keypair
} from '@solana/web3.js';
import { sleep } from "@/utils/sleep";
import { walletScan } from "@/utils/walletScan";
import axios from "axios";
import { RateLimiter } from "@/utils/rate-limiter";
import { toast } from "react-hot-toast";
import { IoMdRefresh } from "react-icons/io";
import { getTokenListMoreThanZero, getTokenListZeroAmount, forceRefreshTokens } from "@/utils/tokenList";
import { TokenInfo } from "@/types/token";
import { cacheOperation, syncOperationsToSupabase, supabase, setupOperationSync } from '@/utils/supabase';
import TokenListSkeleton from './TokenListSkeleton';
import PointsPopup from './PointsPopup';
import { fetchWalletStats } from '@/utils/stats';
import { useReferral } from '@/contexts/referralContext';
import { DEFAULT_PLATFORM_FEE, DEFAULT_REFERRAL_FEE } from '@/types/referral';
import ReloadPopup from './ReloadPopup';
import { SOL_PRICE_API } from "@/config";

const SLIPPAGE = 20;

const RPC_ENDPOINTS = [
  process.env.NEXT_PUBLIC_SOLANA_RPC,
  process.env.NEXT_PUBLIC_SOLANA_RPC_ALT,
  process.env.NEXT_PUBLIC_SOLANA_RPC_HELIUS
].filter(Boolean) as string[]; // Filter out any undefined values

interface SignatureResult {
  sig: string;
  tx: VersionedTransaction;
}

interface JitoBundleResult {
  success: boolean;
  failedTransactions: VersionedTransaction[];
}

// Add Jito constants at the top
const JITO_TIP_ACCOUNT = "JitoNbRYYRPQRt1kGCykKhytNgqf1KGmFjVHkCzGxWn"; // Jito's fee account
const JITO_TIP_LAMPORTS = 100000; // 0.0001 SOL per tx
const LAMPORTS_PER_SOL = 1000000000;

// Add to interfaces at the top
interface BundleResults {
  successfulTokens: string[];
  failedTokens: string[];
  failedTransactions: VersionedTransaction[];
}

interface TokenStatus {
  id: string;
  symbol: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
}

// Add near the top with other constants
const AUTHORIZED_WALLETS = (process.env.NEXT_PUBLIC_AUTHORIZED_WALLETS || '').split(',');

interface UserActions {
  hasSharedTwitter: boolean;
  hasJoinedTelegram: boolean;
}

// Add this new interface near the top
interface ReloadStats {
  tokenCount: number;
  solAmount: number;
  isSwap: boolean;
  dustValue: number;
}

async function getWorkingConnection() {
  for (const endpoint of RPC_ENDPOINTS) {
    try {
      const connection = new Connection(endpoint, "confirmed");
      // Test the connection
      await connection.getLatestBlockhash();
      // console.log(`Connected to RPC: ${endpoint}`);
      return connection;
    } catch (error) {
      // console.warn(`RPC ${endpoint} failed, trying next one...`);
      continue;
    }
  }
  throw new Error("All RPC endpoints failed");
}

// Fix the type name
type SelectedTokens = {
  id: string;
  amount: number;
  symbol: string;
  value: number;
}

// Update function signature
async function createCloseAccountBundle(
  tokens: SelectedTokens[],
  wallet: WalletContextState,
  solConnection: Connection,
  blockhash?: string
): Promise<VersionedTransaction[]> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  
  const closeBundle: VersionedTransaction[] = [];
  const closeInstructions: TransactionInstruction[] = [];
  const feePaid = new Set<string>();
  const devWallet = new PublicKey(process.env.NEXT_PUBLIC_DEV_WALLET!);

  // Bundle all close instructions together
  for (const token of tokens) {
    try {
      const ata = await getAssociatedTokenAddress(
        new PublicKey(token.id),
        wallet.publicKey
      );

      closeInstructions.push(
        createCloseAccountInstruction(
          ata,
          wallet.publicKey,
          wallet.publicKey
        )
      );

      // Add fee payment if not paid for this token
      if (!feePaid.has(token.id)) {
        closeInstructions.push(
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: devWallet,
            lamports: 1_000_000 // 0.001 SOL
          })
        );
        feePaid.add(token.id);
      }
    } catch (error) {
      console.error(`Failed to prepare close for ${token.id}:`, error);
    }
  }

  // Create single transaction with all instructions
  if (closeInstructions.length > 0) {
    // Use provided blockhash or get a new one
    const recentBlockhash = blockhash || 
      await solConnection.getLatestBlockhash().then(res => res.blockhash);
      
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: recentBlockhash as string,
      instructions: closeInstructions
    }).compileToV0Message();

    closeBundle.push(new VersionedTransaction(messageV0));
  }

  return closeBundle;
}

// Update constant at the top
const MAX_TOKENS_PER_BATCH = 15; // Changed from 25 to 15 for optimal Jito bundle size

export default function Home() {
  const { 
    currentAmount, 
    setCurrentAmount, 
    tokenList, 
    setTokenList, 
    selectedTokenList, 
    setSelectedTokenList, 
    swapTokenList, 
    setSwapTokenList, 
    textLoadingState,
    setTextLoadingState, 
    setLoadingText, 
    swapState, 
    setSwapState, 
    setTokeBalance,
    loadingState
  } = useContext<any>(UserContext);
  const wallet = useWallet();
  const { publicKey } = wallet;
  const [allSelectedFlag, setAllSelectedFlag] = useState<boolean | null>(false);
  const [solConnection, setSolConnection] = useState<Connection | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [tokenCounts, setTokenCounts] = useState({ zero: 0, nonZero: 0 });
  const [transferWallet, setTransferWallet] = useState<string>('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [ataProgress, setAtaProgress] = useState({
    total: 0,
    created: 0,
    existing: 0
  });
  const [showAtaDialog, setShowAtaDialog] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [walletLoaded, setWalletLoaded] = useState(false);
  const [points, setPoints] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [userActions, setUserActions] = useState<UserActions>({
    hasSharedTwitter: false,
    hasJoinedTelegram: false
  });
  const { referralInfo, updateEarnings } = useReferral();
  const [showReloadPopup, setShowReloadPopup] = useState(false);
  const [reloadStats, setReloadStats] = useState<ReloadStats>({
    tokenCount: 0,
    solAmount: 0,
    isSwap: false,
    dustValue: 0
  });

  // Add these at the top of the component
  const [solPrice, setSolPrice] = useState<number>(0);

  // Add this useEffect to fetch SOL price
  useEffect(() => {
    const fetchSolPrice = async () => {
      try {
        const response = await fetch(SOL_PRICE_API);
        const data = await response.json();
        setSolPrice(data.solana.usd);
      } catch (error) {
        console.error('Error fetching SOL price:', error);
        setSolPrice(0);
      }
    };

    fetchSolPrice();
    // Refresh price every 60 seconds
    const interval = setInterval(fetchSolPrice, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Initialize connection
    getWorkingConnection().then(connection => {
      setSolConnection(connection);
    }).catch(error => {
      console.error("Failed to initialize connection:", error);
    });
  }, []);

  useEffect(() => {
    if (selectedTokenList.length === tokenList.length && tokenList.length !== 0) {
      setAllSelectedFlag(true)
    } else {
      setAllSelectedFlag(false)
    }
  }, [selectedTokenList, tokenList])

  useEffect(() => {
    if (tokenList) {
      const zero = tokenList.filter((token: TokenInfo) => token.balance === 0).length;
      const nonZero = tokenList.filter((token: TokenInfo) => token.balance > 0).length;
      setTokenCounts({ zero, nonZero });
    }
  }, [tokenList]);

  useEffect(() => {
    // Test Supabase connection and set up operation sync
    const testConnection = async () => {
      try {
        const { data, error } = await supabase
          .from('token_operations')
          .select('*', { count: 'exact', head: true });
        
        if (error) throw error;
        console.log('Supabase connection successful');
        
        // Set up operation sync interval
        const syncInterval = setupOperationSync();
        
        // Clean up interval on component unmount
        return () => clearInterval(syncInterval);
      } catch (error) {
        console.error('Supabase connection error:', error);
      }
    };

    testConnection();
  }, []);

  useEffect(() => {
    if (publicKey) {
      setWalletLoaded(true);
      // Only show popup after wallet is loaded
      setShowPopup(true);
    } else {
      setWalletLoaded(false);
      setShowPopup(false);
      setPoints(0);
      setTokenCount(0);
    }
  }, [publicKey]);

  useEffect(() => {
    const updateStats = async () => {
      if (publicKey && walletLoaded) {
        const stats = await fetchWalletStats(publicKey.toBase58());
        setPoints(stats.points);
        setTokenCount(stats.tokenCount);
      }
    };
    
    updateStats();
  }, [publicKey, walletLoaded]);

  useEffect(() => {
    if (publicKey) {
      const storedActions = localStorage.getItem(`userActions_${publicKey.toString()}`);
      if (storedActions) {
        setUserActions(JSON.parse(storedActions));
      }
    }
  }, [publicKey]);

  useEffect(() => {
    if (publicKey) {
      setWalletLoaded(true);
      // Only show popup if either action is incomplete
      setShowPopup(true);
      const storedActions = localStorage.getItem(`userActions_${publicKey.toString()}`);
      if (storedActions) {
        const actions = JSON.parse(storedActions);
        if (actions.hasSharedTwitter && actions.hasJoinedTelegram) {
          setShowPopup(false);
        }
      }
    } else {
      setWalletLoaded(false);
      setShowPopup(false);
      setPoints(0);
      setTokenCount(0);
    }
  }, [publicKey]);

  // Update the initial state determination logic
  const initializeTokenState = async () => {
    if (!publicKey) return;
    
    setTextLoadingState(true);
    try {
      let zeroTokens = 0;
      let nonZeroTokens = 0;

      // Get counts of both types of tokens
      await getTokenListZeroAmount(
        publicKey.toString(),
        (tokens) => { zeroTokens = tokens.length },
        setTextLoadingState
      );

      await getTokenListMoreThanZero(
        publicKey.toString(),
        (tokens) => { nonZeroTokens = tokens.length },
        setTextLoadingState
      );

      console.log('Initial token counts:', { zeroTokens, nonZeroTokens });

      // Modified logic: If both sections have tokens, prioritize close account section
      const shouldBeInSwapState = nonZeroTokens > 0 && zeroTokens === 0;
      setSwapState(shouldBeInSwapState);

      // Load the appropriate token list
      if (shouldBeInSwapState) {
        await getTokenListMoreThanZero(
          publicKey.toString(),
          setTokenList,
          setTextLoadingState
        );
      } else {
        await getTokenListZeroAmount(
          publicKey.toString(),
          setTokenList,
          setTextLoadingState
        );
      }

      // Update token counts state
      setTokenCounts({ zero: zeroTokens, nonZero: nonZeroTokens });
    } catch (error) {
      console.error('Error initializing token state:', error);
    } finally {
      setTextLoadingState(false);
    }
  };

  // Update the calculateTotalValue function
const calculateTotalValue = (tokens: TokenInfo[]) => {
  if (!tokens || !solPrice || solPrice === 0) return 0;
  return Number(tokens.reduce((total, token) => {
    const dollarValue = token.price * token.balance;
    return total + (dollarValue / solPrice); // Convert to SOL value
  }, 0).toFixed(4));
};

  const handleClosePopup = () => {
    setShowPopup(false);
  };

  const changeToken = async () => {
    if (!publicKey?.toBase58()) {
      warningAlert("please connect wallet");
      return;
    }
    if (selectedTokenList.length === 0) {
      warningAlert("You must select at least one token");
      return;
    }
    if (selectedTokenList.length > MAX_TOKENS_PER_BATCH) {
      warningAlert(`Maximum ${MAX_TOKENS_PER_BATCH} tokens can be processed at once`);
      return;
    }

    setSwapTokenList(selectedTokenList);
    if (swapState) {
      await Swap(selectedTokenList);
    } else {
      await CloseAndFee(selectedTokenList);
    }
  }
  
  // Modify sendJitoBundles function to include Jito tip
  async function sendJitoBundles(txs: VersionedTransaction[], tokens: SelectedTokens[]): Promise<BundleResults> {
    const signAllTransactions = wallet?.signAllTransactions;
    if (!signAllTransactions || !wallet?.publicKey || !solConnection) {
      throw new Error("Wallet not ready for signing");
    }

    const failedTransactions: VersionedTransaction[] = [];
    const successfulTokens: string[] = [];
    const failedTokens: string[] = [];
    const promises = [];

    const tokenStatusMap = new Map<string, TokenStatus>();
    tokens.forEach(token => {
      tokenStatusMap.set(token.id, {
        id: token.id,
        symbol: token.symbol,
        status: 'pending'
      });
    });

    for (let j = 0; j < txs.length; j += 5) {
      const bundleSize = Math.min(5, txs.length - j);
      const bundleTxs = txs.slice(j, j + bundleSize);
      
      const bundlePromise = (async () => {
        try {
          const { blockhash, lastValidBlockHeight } = await solConnection.getLatestBlockhash('confirmed');
          
          // Create new transactions with fresh blockhash
          const updatedTxs = bundleTxs.map(tx => {
            // Keep original transaction data but update blockhash
            const newTx = new VersionedTransaction(tx.message);
            newTx.message.recentBlockhash = blockhash;
            return newTx;
          });

          console.log("Signing bundle with blockhash:", blockhash);
          const signedBundle = await signAllTransactions(updatedTxs);

          // Process signed transactions
          const signatures: SignatureResult[] = [];
          const processedTokens = new Set<string>();
          await Promise.all(signedBundle.map(async (tx, idx) => {
            try {
              const sig = await solConnection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 3,
              });
              
              signatures.push({ sig, tx });
              if (tokens[j + idx]?.id && !processedTokens.has(tokens[j + idx].id)) {
                processedTokens.add(tokens[j + idx].id);
                successfulTokens.push(tokens[j + idx].id);
              }

              // Wait for confirmation and check status
              const confirmation = await solConnection.confirmTransaction({
                signature: sig,
                lastValidBlockHeight,
                blockhash
              });

              if (confirmation.value.err) {
                console.error(`Transaction failed: ${sig}`, confirmation.value.err);
                tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
                tokenStatusMap.get(tokens[j + idx].id)!.error = confirmation.value.err.toString();
                // Remove from successful if it failed confirmation
                const tokenIndex = successfulTokens.indexOf(tokens[j + idx].id);
                if (tokenIndex > -1) {
                  successfulTokens.splice(tokenIndex, 1);
                }
                if (!failedTokens.includes(tokens[j + idx].id)) {
                  failedTokens.push(tokens[j + idx].id);
                }
              } else {
                // Verify transaction success on chain
                const txInfo = await solConnection.getTransaction(sig, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0
                });
                
                if (txInfo?.meta?.err) {
                  tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
                  // Remove from successful if it failed on-chain
                  const tokenIndex = successfulTokens.indexOf(tokens[j + idx].id);
                  if (tokenIndex > -1) {
                    successfulTokens.splice(tokenIndex, 1);
                  }
                  if (!failedTokens.includes(tokens[j + idx].id)) {
                    failedTokens.push(tokens[j + idx].id);
                  }
                } else {
                  tokenStatusMap.get(tokens[j + idx].id)!.status = 'success';
                  // Success notification only if we haven't already processed this token
                  if (!processedTokens.has(tokens[j + idx].id)) {
                    processedTokens.add(tokens[j + idx].id);
                    successAlert(`Successfully processing ${tokens[j + idx].symbol}`);
                  }
                }
              }
            } catch (error: any) {
              console.error(`Transaction failed:`, error);
              tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
              tokenStatusMap.get(tokens[j + idx].id)!.error = error?.message || 'Unknown error';
              // Remove from successful if it failed
              const tokenIndex = successfulTokens.indexOf(tokens[j + idx].id);
              if (tokenIndex > -1) {
                successfulTokens.splice(tokenIndex, 1);
              }
              if (!failedTokens.includes(tokens[j + idx].id)) {
                failedTokens.push(tokens[j + idx].id);
              }
              warningAlert(`Failed to process ${tokens[j + idx].symbol}: ${error?.message || 'Unknown error'}`);
            }
          }));

          // Confirm transactions
          if (signatures.length > 0) {
            await Promise.all(
              signatures.map(({ sig }) => 
                solConnection.confirmTransaction({
                  signature: sig,
                  lastValidBlockHeight,
                  blockhash
                })
              )
            );
          }

          return signatures.length === bundleSize;
        } catch (error) {
          console.error(`Bundle failed:`, error);
          bundleTxs.forEach((tx, idx) => {
            failedTransactions.push(tx);
            tokens[j + idx]?.id && failedTokens.push(tokens[j + idx].id);
          });
          return false;
          }
        })();

      promises.push(bundlePromise);
      }

      await Promise.all(promises);

    // Log final status for debugging
    console.log("Final token processing status:", 
      Array.from(tokenStatusMap.values()).map(t => ({
        symbol: t.symbol,
        status: t.status,
        error: t.error
      }))
    );

    return {
      successfulTokens,
      failedTokens,
      failedTransactions
    };
  }

  const createFeeTransferInstructions = async (
    amount: number,
    feePayer: PublicKey
  ) => {
    const instructions: TransactionInstruction[] = [];
    
    if (referralInfo?.isActive) {
      const platformAmount = amount * DEFAULT_PLATFORM_FEE;
      const referralAmount = amount * DEFAULT_REFERRAL_FEE;
      
      // Platform fee transfer
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: feePayer,
          toPubkey: new PublicKey(process.env.NEXT_PUBLIC_JITO_TIP_ACCOUNT!),
          lamports: platformAmount,
        })
      );
      
      // Referral fee transfer
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: feePayer,
          toPubkey: new PublicKey(referralInfo.referrerWallet),
          lamports: referralAmount,
        })
      );

      // Update referrer earnings in database
      await updateEarnings(referralAmount / LAMPORTS_PER_SOL);
    } else {
      // Standard fee transfer
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: feePayer,
          toPubkey: new PublicKey(process.env.NEXT_PUBLIC_JITO_TIP_ACCOUNT!),
          lamports: amount,
        })
      );
    }
    
    return instructions;
  };

  const CloseAndFee = async (selectedTokens: SelectedTokens[]) => {
    if (!solConnection || !wallet || !wallet.publicKey || !wallet.signAllTransactions) {
      warningAlert("Please check your wallet connection");
      return;
    }

    setLoadingText("Preparing close transactions...");
    setTextLoadingState(true);

    try {
      // Get latest blockhash first
      const { blockhash, lastValidBlockHeight } = await solConnection.getLatestBlockhash('confirmed');
      
      // Create transactions with this blockhash
      const closeBundle = await createCloseAccountBundle(
        selectedTokens, 
        wallet, 
        solConnection,
        blockhash
      );
      
      if (closeBundle.length > 0) {
        setLoadingText("Signing close transactions...");
        const signedBundle = await wallet.signAllTransactions(closeBundle);
        
        setLoadingText("Processing closes...");
        const closeResults = await sendTransactions(
          signedBundle, 
          selectedTokens,
          solConnection,
          blockhash,
          lastValidBlockHeight,
          'close'
        );

        // Track successful operations
        if (closeResults.successfulTokens.length > 0) {
          cacheOperation(
            wallet.publicKey.toString(),
            'close',
            closeResults.successfulTokens.length
          );
          const solAmount = closeResults.successfulTokens.length * 0.001;
          setReloadStats({
            tokenCount: closeResults.successfulTokens.length,
            solAmount: solAmount,
            isSwap: false,
            dustValue: 0
          });
          setShowReloadPopup(true);
          successAlert(`You've been Reload your SOL`);
        }
        if (closeResults.failedTokens.length > 0) {
          warningAlert(`Failed to close ${closeResults.failedTokens.length} accounts`);
        }
      }
    } catch (error: any) {
      console.error("Error during close:", error);
      warningAlert(error?.message || "Failed to close accounts");
    } finally {
      setLoadingText("Refreshing token list...");
      await sleep(5000); // Add 5 second delay before refresh
      await refreshTokenList();
      setLoadingText("");
      setTextLoadingState(false);
    }
  };

  const Swap = async (selectedTokens: SelectedTokens[]) => {
    if (!solConnection || !wallet || !wallet.publicKey || !wallet.signAllTransactions) {
      console.error("Connection, wallet, or signing not available");
      warningAlert("Please check your wallet connection");
      return;
    }

    setLoadingText("Preparing transactions...");
    setTextLoadingState(true);

    try {
      // Step 1: Prepare all swap transactions first
      const swapBundle: VersionedTransaction[] = [];
      const rateLimiter = new RateLimiter(2);

      // Collect all swap transactions
      for (const token of selectedTokens) {
        try {
          console.log(`Preparing swap for ${token.id}`);
          const quoteResponse = await rateLimiter.schedule(async () => {
            const response = await fetch(
              `https://swap-v2.solanatracker.io/rate?` + new URLSearchParams({
                from: token.id,
                to: NATIVE_MINT.toBase58(),
                amount: token.amount.toString(),
                slippage: SLIPPAGE.toString()
              })
            );

            if (!response.ok) throw new Error(`Quote failed: ${response.statusText}`);
            return await response.json();
          });

          const swapResponse = await rateLimiter.schedule(async () => {
            const response = await fetch("https://swap-v2.solanatracker.io/swap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                from: token.id,
                to: NATIVE_MINT.toBase58(),
                amount: token.amount,
                slippage: SLIPPAGE,
                payer: wallet.publicKey?.toBase58(),
                priorityFee: 0.0005,
                feeType: "add",
                fee: "3V3N5xh6vUUVU3CnbjMAXoyXendfXzXYKzTVEsFrLkgX:0.1"
              })
            });

            if (!response.ok) throw new Error(`Swap request failed: ${response.statusText}`);
            return await response.json();
          });

          if (swapResponse.txn) {
            const tx = VersionedTransaction.deserialize(Buffer.from(swapResponse.txn, 'base64'));
            swapBundle.push(tx);
          }
        } catch (error) {
          console.error(`Failed to prepare swap for ${token.id}:`, error);
        }
      }

      // Step 2: Execute swap bundle
      if (swapBundle.length > 0) {
        const { blockhash, lastValidBlockHeight } = await solConnection.getLatestBlockhash('confirmed');
        
        const updatedSwapBundle = swapBundle.map(tx => {
          const newTx = new VersionedTransaction(tx.message);
          newTx.message.recentBlockhash = blockhash;
          return newTx;
        });
        
        setLoadingText("Signing swap transactions...");
        const signedSwapBundle = await wallet.signAllTransactions(updatedSwapBundle);
        
        setLoadingText("Processing swaps...");
        const swapResults = await sendTransactions(
          signedSwapBundle, 
          selectedTokens,
          solConnection,
          blockhash,
          lastValidBlockHeight,
          'swap'
        );

        // Track successful swaps
        if (swapResults.successfulTokens.length > 0) {
          cacheOperation(
            wallet.publicKey.toString(),
            'close',
            swapResults.successfulTokens.length
          );

          // Create close bundle for successful swaps
          const tokensToClose = selectedTokens.filter(
            token => swapResults.successfulTokens.includes(token.id)
          );
          
          const closeBundle = await createCloseAccountBundle(
            tokensToClose, 
            wallet, 
            solConnection,
            blockhash
          );
          
          if (closeBundle.length > 0) {
            setLoadingText("Signing close transactions...");
            const signedCloseBundle = await wallet.signAllTransactions(closeBundle);
            
            setLoadingText("Processing closes...");
            const closeResults = await sendTransactions(
              signedCloseBundle, 
              tokensToClose,
              solConnection,
              blockhash,
              lastValidBlockHeight,
              'close'
            );

            // Track successful operations
            if (closeResults.successfulTokens.length > 0) {
              cacheOperation(
                wallet.publicKey.toString(),
                'close',
                closeResults.successfulTokens.length
              );
              
              const baseAmount = closeResults.successfulTokens.length * 0.001;
              const dustValue = calculateTotalValue(tokenList);
              const totalAmount = baseAmount + dustValue;
              
              setReloadStats({
                tokenCount: closeResults.successfulTokens.length,
                solAmount: totalAmount,
                isSwap: true,
                dustValue: dustValue
              });
              setShowReloadPopup(true);
              successAlert(`Successfully processed: ${closeResults.successfulTokens.length} tokens`);
            }
            if (closeResults.failedTokens.length > 0) {
              warningAlert(`Failed to close ${closeResults.failedTokens.length} accounts`);
            }
          }
        }
      }

      // Add 5 second delay before refresh
      setLoadingText("Refreshing token list...");
      await sleep(5000);
      await refreshTokenList();
    } catch (err) {
      console.error("Error during swap process:", err);
      warningAlert("Some operations failed. Please check the console for details.");
    } finally {
      setLoadingText("");
      setTextLoadingState(false);
    }
  };

  const updateCheckState = (id: string, amount: number, symbol: string, value: number) => {
    if (selectedTokenList.length >= MAX_TOKENS_PER_BATCH && 
        !selectedTokenList.some((_token: any) => _token.id === id)) {
      warningAlert(`Maximum ${MAX_TOKENS_PER_BATCH} tokens can be selected at once`);
      return;
    }

    if (selectedTokenList.some((_token: any) => _token.id === id)) {
      setSelectedTokenList(selectedTokenList.filter((_token: any) => _token.id != id));
      setAllSelectedFlag(false);
    } else {
      const updatedList = [...selectedTokenList, { id, amount, symbol, value }];
      setSelectedTokenList(updatedList);
    }
  };

  const handleAllSelectedCheckBox = () => {
    if (allSelectedFlag === false) {
      const tokensToSelect = tokenList.slice(0, MAX_TOKENS_PER_BATCH);
      const _selectedToken = tokensToSelect.map((token: any) => ({
        id: token.id,
        amount: token.balance,
        symbol: token.symbol,
        value: token.price * token.balance,
      }));
      
      setSelectedTokenList(_selectedToken);
      setAllSelectedFlag(tokenList.length <= MAX_TOKENS_PER_BATCH);
      
      if (tokenList.length > MAX_TOKENS_PER_BATCH) {
        warningAlert(`Selected first ${MAX_TOKENS_PER_BATCH} tokens. Process these before selecting more.`);
      }
    } else {
      setSelectedTokenList([]);
      setAllSelectedFlag(false);
    }
  };

  function filterTokenAccounts(accounts: any[], targetMint: string, targetOwner: string): Array<{ pubkey: string; mint: string }> {
    return accounts
      .filter(account => {
        return (
          account.account.data.parsed.info.mint === targetMint
        );
      })
      .map(account => ({
        pubkey: account.pubkey,
        mint: account.account.data.parsed.info.mint
      }));
  }

  const getWalletTokeBalance = async () => {
    if (publicKey === null) {
      return;
    }
    const tokeAmount = await walletScan(publicKey?.toString());
    console.log('toke amount ===> ', tokeAmount)
    setTokeBalance(tokeAmount);
  }

  const swappedTokenNotify = async (mintAddress: string) => {
    let newFilterList: any[] = [];
    let newTokenList: any[] = [];
    let newSwapList: any[] = [];
    let newSelectedList: any[] = [];

    newTokenList = await tokenList.filter((item: { id: string; }) => item.id !== mintAddress);
    setTokenList(newTokenList)

    await sleep(15000);
    await getWalletTokeBalance();
  }

  const changeMethod = async () => {
    setSelectedTokenList([]);
    
    if (publicKey) {
      setTextLoadingState(true);
      try {
        // Check both lists
        let zeroTokens = 0;
        let nonZeroTokens = 0;

        // Get zero amount tokens
        await getTokenListZeroAmount(
          publicKey.toString(),
          (tokens) => { zeroTokens = tokens.length },
          setTextLoadingState
        );

        // Get non-zero amount tokens
        await getTokenListMoreThanZero(
          publicKey.toString(),
          (tokens) => { nonZeroTokens = tokens.length },
          setTextLoadingState
        );

        console.log('Token counts:', { zeroTokens, nonZeroTokens, currentState: swapState });

        // If no tokens in current section, switch to the other if it has tokens
        if (swapState && nonZeroTokens === 0 && zeroTokens > 0) {
          // Currently in swap (non-zero) but no tokens, switch to zero if available
          setSwapState(false);
          await getTokenListZeroAmount(
            publicKey.toString(),
            setTokenList,
            setTextLoadingState
          );
        } else if (!swapState && zeroTokens === 0 && nonZeroTokens > 0) {
          // Currently in zero but no tokens, switch to non-zero if available
          setSwapState(true);
          await getTokenListMoreThanZero(
            publicKey.toString(),
            setTokenList,
            setTextLoadingState
          );
        } else {
          // Normal toggle behavior when both lists have tokens
          const newState = !swapState;
          setSwapState(newState);
          if (newState) {
            await getTokenListMoreThanZero(
              publicKey.toString(),
              setTokenList,
              setTextLoadingState
            );
          } else {
            await getTokenListZeroAmount(
              publicKey.toString(),
              setTokenList,
              setTextLoadingState
            );
          }
        }
      } catch (error) {
        console.error('Error changing token list:', error);
      } finally {
        setTextLoadingState(false);
      }
    }
  };

  const updateTokenList = async () => {
    if (!publicKey) return;
    setLoadingProgress(0);
    await getTokenListMoreThanZero(
      publicKey.toString(), 
      setTokenList, 
      setTextLoadingState,
      (progress) => setLoadingProgress(progress)
    );
  };

  const refreshTokenList = async () => {
    if (!publicKey || isRefreshing || !wallet) return;
    
    setIsRefreshing(true);
    try {
      // Force refresh tokens to clear cache
      forceRefreshTokens();
      
      console.log('Refreshing token list with forced cache clear');

      // Check both lists first
      let zeroTokens: TokenInfo[] = [];
      let nonZeroTokens: TokenInfo[] = [];
      
      // Get both lists in parallel
      await Promise.all([
        getTokenListZeroAmount(
          publicKey.toString(),
          (tokens) => { zeroTokens = tokens; },
          setTextLoadingState
        ),
        getTokenListMoreThanZero(
          publicKey.toString(),
          (tokens) => { nonZeroTokens = tokens; },
          setTextLoadingState,
          (progress) => setLoadingProgress(progress)
        )
      ]);

      console.log('Token counts after refresh:', {
        zeroTokens: zeroTokens.length,
        nonZeroTokens: nonZeroTokens.length,
        currentState: swapState
      });

      // Determine which section to show based on available tokens
      if (swapState && nonZeroTokens.length === 0 && zeroTokens.length > 0) {
        // Currently in swap (non-zero) but no tokens, switch to zero if available
        setSwapState(false);
        setTokenList(zeroTokens);
      } else if (!swapState && zeroTokens.length === 0 && nonZeroTokens.length > 0) {
        // Currently in zero but no tokens, switch to non-zero if available
        setSwapState(true);
        setTokenList(nonZeroTokens);
      } else {
        // Stay in current section but update the list
        setTokenList(swapState ? nonZeroTokens : zeroTokens);
      }

      // Update token counts
      setTokenCounts({
        zero: zeroTokens.length,
        nonZero: nonZeroTokens.length
      });

      // Clear selection
      setSelectedTokenList([]);

      successAlert("Token list refreshed");
    } catch (error) {
      console.error('Refresh error:', error);
      warningAlert("Failed to refresh token list");
    } finally {
      setLoadingText("");
      setIsRefreshing(false);
    }
  };

  // Update transferTokens function to use batching and track operations
  const transferTokens = async (selectedTokens: SelectedTokens[]) => {
    if (!solConnection || !wallet || !wallet.publicKey || !wallet.signAllTransactions) {
      warningAlert("Please check your wallet connection");
      return;
    }

    if (!transferWallet) {
      warningAlert("Please enter destination wallet address");
      return;
    }

    setLoadingText("Preparing transfer transactions...");
    setTextLoadingState(true);

    try {
      const destinationWallet = new PublicKey(transferWallet);
      const transferBundles: VersionedTransaction[] = [];
      const BATCH_SIZE = 5; // Process 5 tokens per transaction

      // Create batches of transfer instructions
      for (let i = 0; i < selectedTokens.length; i += BATCH_SIZE) {
        const batchInstructions: TransactionInstruction[] = [];
        const batchTokens = selectedTokens.slice(i, i + BATCH_SIZE);

        for (const token of batchTokens) {
          try {
            const sourceAta = await getAssociatedTokenAddress(
              new PublicKey(token.id),
              wallet.publicKey
            );
            const destAta = await getAssociatedTokenAddress(
              new PublicKey(token.id),
              destinationWallet
            );

            batchInstructions.push(
              createTransferInstruction(
                sourceAta,
                destAta,
                wallet.publicKey,
                token.amount
              )
            );
          } catch (error) {
            console.error(`Failed to prepare transfer for ${token.id}:`, error);
          }
        }

        if (batchInstructions.length > 0) {
          const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: await solConnection.getLatestBlockhash().then(res => res.blockhash),
            instructions: batchInstructions
          }).compileToV0Message();

          transferBundles.push(new VersionedTransaction(messageV0));
        }
      }

      // Process bundles using existing sendJitoBundles
      if (transferBundles.length > 0) {
        setLoadingText("Signing transfer transactions...");
        const signedBundles = await wallet.signAllTransactions(transferBundles);
        
        setLoadingText("Processing transfers...");
        const results = await sendJitoBundles(signedBundles, selectedTokens);

        if (results.successfulTokens.length > 0) {
          cacheOperation(
            wallet.publicKey.toString(),
            'swap', // Using 'swap' as the operation type for transfers
            results.successfulTokens.length
          );
          successAlert(`Successfully transferred ${results.successfulTokens.length} tokens`);
        }
        if (results.failedTokens.length > 0) {
          warningAlert(`Failed to transfer ${results.failedTokens.length} tokens`);
        }
      }

      // Add 5 second delay before refresh
      setLoadingText("Refreshing token list...");
      await sleep(5000);
      await refreshTokenList();
    } catch (error: any) {
      console.error("Error during transfer:", error);
      warningAlert(error?.message || "Failed to transfer tokens");
    } finally {
      setLoadingText("");
      setTextLoadingState(false);
    }
  };

  // Add isAuthorizedWallet check
  const isAuthorizedWallet = (publicKey: PublicKey | null): boolean => {
    if (!publicKey) return false;
    return AUTHORIZED_WALLETS.includes(publicKey.toString());
  };

  // Add confirmation dialog component
  const ConfirmDialog = ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-black border-[1px] border-white/30 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-white text-lg font-semibold mb-4">Confirm Transfer</h3>
        
        <div className="mb-4">
          <label className="block text-white text-sm font-bold mb-2">
            Transfer to wallet:
          </label>
          <input
            type="text"
            value={transferWallet}
            onChange={(e) => setTransferWallet(e.target.value)}
            className="w-full px-3 py-2 bg-black/50 text-white border border-white/30 rounded focus:outline-none focus:border-white/50"
            placeholder="Enter destination wallet address"
          />
        </div>

        <div className="text-white mb-4">
          Are you sure you want to transfer {selectedTokenList.length} tokens?
        </div>

        <div className="flex justify-end gap-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-white text-white rounded hover:bg-white hover:text-black transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-white text-black rounded hover:bg-gray-200 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );

  // Single instance of validateAndTransfer
  const validateAndTransfer = async () => {
    try {
      const destinationWallet = new PublicKey(transferWallet);
      if (!destinationWallet) {
        warningAlert("Invalid destination wallet address");
        return;
      }
      await transferTokens(selectedTokenList);
      setShowConfirmDialog(false);
    } catch (error) {
      warningAlert("Invalid wallet address format");
    }
  };

  // Add validation function for ATA creation
  const validateAndCreateATAs = async () => {
    try {
      const destinationWallet = new PublicKey(transferWallet);
      if (!destinationWallet) {
        warningAlert("Invalid destination wallet address");
        return;
      }
      await createDestinationATAs(selectedTokenList, destinationWallet);
      setShowAtaDialog(false);
    } catch (error) {
      warningAlert("Invalid wallet address format");
    }
  };

  // Single instance of createDestinationATAs
  const createDestinationATAs = async (selectedTokens: SelectedTokens[], destinationWallet: PublicKey) => {
    if (!solConnection || !wallet || !wallet.publicKey) {
      warningAlert("Please check your wallet connection");
      return;
    }

    setLoadingText("Preparing ATA creation...");
    setTextLoadingState(true);
    setAtaProgress({ total: selectedTokens.length, created: 0, existing: 0 });

    try {
      const BATCH_SIZE = 5;
      const ataBundles: VersionedTransaction[] = [];
      const accountChecks: Promise<{ token: SelectedTokens, account: any }>[] = [];

      // Prepare all account checks in parallel
      selectedTokens.forEach(token => {
        accountChecks.push((async () => {
          const destAta = await getAssociatedTokenAddress(
            new PublicKey(token.id),
            destinationWallet
          );
          const account = await solConnection.getAccountInfo(destAta);
          return { token, account };
        })());
      });

      // Wait for all account checks to complete
      const accountResults = await Promise.all(accountChecks);
      const tokensNeedingAta = accountResults.filter(result => !result.account);

      // Update progress for existing accounts
      const existingCount = accountResults.length - tokensNeedingAta.length;
      setAtaProgress(prev => ({ ...prev, existing: existingCount }));

      if (tokensNeedingAta.length === 0) {
        successAlert("All ATAs already exist!");
        return;
      }

      // Process tokens needing ATAs in batches
      for (let i = 0; i < tokensNeedingAta.length; i += BATCH_SIZE) {
        const batchTokens = tokensNeedingAta.slice(i, i + BATCH_SIZE);
        const batchInstructions: TransactionInstruction[] = [];

        for (const { token } of batchTokens) {
          try {
            const destAta = await getAssociatedTokenAddress(
              new PublicKey(token.id),
              destinationWallet
            );
            
            batchInstructions.push(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                destAta,
                destinationWallet,
                new PublicKey(token.id)
              )
            );
          } catch (error) {
            console.error(`Failed to prepare ATA for ${token.id}:`, error);
          }
        }

        if (batchInstructions.length > 0) {
          const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: await solConnection.getLatestBlockhash().then(res => res.blockhash),
            instructions: batchInstructions
          }).compileToV0Message();

          ataBundles.push(new VersionedTransaction(messageV0));
        }
      }

      // Process bundles - only one signing operation
      if (ataBundles.length > 0) {
        setLoadingText("Creating ATAs...");
        if (!wallet.signAllTransactions) {
          throw new Error("Wallet does not support signing");
        }
        const signedBundles = await wallet.signAllTransactions(ataBundles);
        
        const results = await sendJitoBundles(signedBundles, tokensNeedingAta.map(r => r.token));

        setAtaProgress(prev => ({ 
          ...prev, 
          created: results.successfulTokens.length 
        }));

        if (results.successfulTokens.length > 0) {
          successAlert(`Created ${results.successfulTokens.length} new ATAs`);
        }
        if (results.failedTokens.length > 0) {
          warningAlert(`Failed to create ${results.failedTokens.length} ATAs`);
        }
      }

      // Add 5 second delay before refresh
      setLoadingText("Refreshing token list...");
      await sleep(5000);
      await refreshTokenList();
    } catch (error: any) {
      console.error("Error during ATA creation:", error);
      warningAlert(error?.message || "Failed to create ATAs");
    } finally {
      setLoadingText("");
      setTextLoadingState(false);
      setAtaProgress({ total: 0, created: 0, existing: 0 });
    }
  };

  // Add cost calculation helper
  const calculateAtaCost = (tokensToCreate: number) => {
    const COST_PER_ATA = 0.002; // SOL
    return (tokensToCreate * COST_PER_ATA).toFixed(3);
  };

  // Update ATA Dialog component to show cost estimate
  const AtaDialog = ({ onConfirm, onCancel }: { onConfirm: () => void, onCancel: () => void }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-black border-[1px] border-white/30 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-white text-lg font-semibold mb-4">Create Token Accounts</h3>
        
        <div className="mb-4">
          <label className="block text-white text-sm font-bold mb-2">
            Destination wallet:
          </label>
          <input
            type="text"
            value={transferWallet}
            onChange={(e) => setTransferWallet(e.target.value)}
            className="w-full px-3 py-2 bg-black/50 text-white border border-white/30 rounded focus:outline-none focus:border-white/50"
            placeholder="Enter destination wallet address"
          />
        </div>

        <div className="text-white mb-2">
          Create token accounts for {selectedTokenList.length} tokens?
        </div>

        <div className="text-white text-sm mb-4 bg-black/50 p-3 rounded border border-white/10">
          <p>Estimated cost: ~{calculateAtaCost(selectedTokenList.length)} SOL</p>
          <p className="mt-1 text-xs opacity-75">
            * Cost per ATA: 0.002 SOL
          </p>
        </div>

        <div className="flex justify-end gap-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-white text-white rounded hover:bg-white hover:text-black transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-white text-black rounded hover:bg-gray-200 transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );


  // New helper function that doesn't re-sign transactions
  async function sendTransactions(
    signedTxs: VersionedTransaction[], 
    tokens: SelectedTokens[],
    connection: Connection,
    blockhash: string,
    lastValidBlockHeight: number,
    bundleType: 'close' | 'swap' = 'swap'  // default to 'swap' for backward compatibility
  ): Promise<BundleResults> {
    if (!connection) {
      throw new Error("Connection not available");
    }

    const failedTransactions: VersionedTransaction[] = [];
    const successfulTokens: string[] = [];
    const failedTokens: string[] = [];
    const promises = [];
    const confirmationPromises: Promise<void>[] = [];

    const tokenStatusMap = new Map<string, TokenStatus>();
    tokens.forEach(token => {
      tokenStatusMap.set(token.id, {
        id: token.id,
        symbol: token.symbol,
        status: 'pending'
      });
    });

    for (let j = 0; j < signedTxs.length; j += 5) {
      const bundleSize = Math.min(5, signedTxs.length - j);
      const bundleTxs = signedTxs.slice(j, j + bundleSize);
      
      const bundlePromise = (async () => {
        try {
          // Process signed transactions
          const signatures: SignatureResult[] = [];
          const sendPromises = bundleTxs.map(async (tx, idx) => {
            try {
              const sig = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 3,
              });
              
              signatures.push({ sig, tx });
              
              // Add confirmation promise to our array
              const confirmationPromise = (async () => {
                try {
                  // Wait for confirmation with longer timeout
                  const confirmation = await connection.confirmTransaction({
                    signature: sig,
                    lastValidBlockHeight,
                    blockhash
                  }, 'confirmed');

                  if (confirmation.value.err) {
                    console.error(`Transaction failed: ${sig}`, confirmation.value.err);
                    tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
                    tokenStatusMap.get(tokens[j + idx].id)!.error = confirmation.value.err.toString();
                    failedTokens.push(tokens[j + idx].id);
                  } else {
                    // Additional verification with getTransaction
                    const txInfo = await connection.getTransaction(sig, {
                      commitment: 'confirmed',
                      maxSupportedTransactionVersion: 0
                    });
                    
                    if (txInfo?.meta?.err) {
                      tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
                      failedTokens.push(tokens[j + idx].id);
                    } else {
                      tokenStatusMap.get(tokens[j + idx].id)!.status = 'success';
                      successfulTokens.push(tokens[j + idx].id);
                      successAlert(`Successfully processed ${tokens[j + idx].symbol}`);
                    }
                  }
                } catch (error: any) {
                  console.error(`Confirmation failed for ${sig}:`, error);
                  tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
                  failedTokens.push(tokens[j + idx].id);
                }
              })();
              
              confirmationPromises.push(confirmationPromise);
              
            } catch (error: any) {
              console.error(`Transaction failed:`, error);
              tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
              tokenStatusMap.get(tokens[j + idx].id)!.error = error?.message || 'Unknown error';
              failedTokens.push(tokens[j + idx].id);
              warningAlert(`Failed to process ${tokens[j + idx].symbol}: ${error?.message || 'Unknown error'}`);
            }
          });

          // Wait for all transactions in this bundle to be sent
          await Promise.all(sendPromises);

          return signatures.length === bundleSize;
        } catch (error) {
          console.error(`Bundle failed:`, error);
          bundleTxs.forEach((tx, idx) => {
            failedTransactions.push(tx);
            tokens[j + idx]?.id && failedTokens.push(tokens[j + idx].id);
          });
          return false;
        }
      })();

      promises.push(bundlePromise);
    }

   // Add this helper function to check for pending tokens
  const hasPendingTokens = (statusMap: Map<string, TokenStatus>): boolean => {
    return Array.from(statusMap.values()).some(t => t.status === 'pending');
  };

  // Wait for all confirmations to complete
  setLoadingText("Waiting for confirmations...");

  // Process confirmations sequentially
  for (const confirmationPromise of confirmationPromises) {
    try {
      await confirmationPromise;
      
      // For Close Account operations, mark all tokens in the bundle as successful
      // since they are processed together
      if (bundleType === 'close') {
        tokens.forEach(token => {
          if (tokenStatusMap.get(token.id)?.status === 'pending') {
            tokenStatusMap.set(token.id, {
              id: token.id,
              symbol: token.symbol,
              status: 'success'
            });
            successfulTokens.push(token.id);
          }
        });
      }
    } catch (error: any) {
      console.error("Confirmation failed:", error);
      // For Close Account operations, mark all pending tokens as failed
      if (bundleType === 'close') {
        tokens.forEach(token => {
          if (tokenStatusMap.get(token.id)?.status === 'pending') {
            tokenStatusMap.set(token.id, {
              id: token.id,
              symbol: token.symbol,
              status: 'failed',
              error: error?.message || 'Failed during bundle confirmation'
            });
            failedTokens.push(token.id);
          }
        });
      }
    }
  }

  // Final check for any remaining pending tokens
  let retryCount = 0;
  while (hasPendingTokens(tokenStatusMap) && retryCount < 3) {
    console.log("Found pending tokens, waiting additional 1 second...");
    await sleep(1000);
    retryCount++;
  }

  // Log final status for debugging
  console.log("Final token processing status:", 
    Array.from(tokenStatusMap.values()).map(t => ({
      symbol: t.symbol,
      status: t.status,
      error: t.error
    }))
  );

    // Remove duplicates from arrays
    const uniqueSuccessfulTokens = Array.from(new Set(successfulTokens));
    const uniqueFailedTokens = Array.from(new Set(failedTokens));

    return {
      successfulTokens: uniqueSuccessfulTokens,
      failedTokens: uniqueFailedTokens,
      failedTransactions
    };
  }

  const handleTwitterShare = () => {
    const newActions = { ...userActions, hasSharedTwitter: true };
    setUserActions(newActions);
    localStorage.setItem(`userActions_${publicKey?.toString()}`, JSON.stringify(newActions));
    
    // If both actions are now complete, close the popup
    if (newActions.hasJoinedTelegram) {
      setShowPopup(false);
    }
  };

  const handleTelegramJoin = () => {
    const newActions = { ...userActions, hasJoinedTelegram: true };
    setUserActions(newActions);
    localStorage.setItem(`userActions_${publicKey?.toString()}`, JSON.stringify(newActions));
    
    // If both actions are now complete, close the popup
    if (newActions.hasSharedTwitter) {
      setShowPopup(false);
    }
  };

  // Add this helper function near other UI-related functions
  const canSwitchSection = (currentState: boolean, zeroCounts: number, nonZeroCounts: number) => {
    if (currentState) {
      // In swap/dust state (non-zero), check if there are zero tokens to switch to
      return zeroCounts > 0;
    } else {
      // In useless state (zero), check if there are non-zero tokens to switch to
      return nonZeroCounts > 0;
    }
  };

  return (
    <div className="pt-10 relative z-30">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col items-center justify-between w-full h-full rounded-xl border-[1px] border-white max-w-4xl mx-auto py-6 gap-4 relative">
          <div className="w-full flex justify-between flex-col sm2:flex-row items-center h-full px-4 border-b-[1px] border-b-white pb-4">
            <div className="text-white text-md mb-2 sm2:mb-0">
              <div className="relative group">
                <span className="hover:text-gray-300 transition-colors">
                  You have around <span className="font-bold">
                    {swapState ? (
                      <>
                        ~{((tokenList?.length || 0) * 0.001) + (calculateTotalValue(tokenList))} SOL
                      </>
                    ) : (
                      <>
                        {(tokenList?.length || 0) * 0.001} SOL
                      </>
                    )}
                  </span> to reload 🚀
                </span>
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 bg-black text-white text-xs rounded border border-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 w-full">
                  💎 <a href="https://t.me/+qIpGWaw6bXwzMWVl" target="_blank" rel="noopener noreferrer" className="hover:text-gray-300 transition-colors">Join our community here</a> 💎 
                  <br /> and be a part of IYKYK! 😉
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 border-l-4 border-r-4 border-b-4 border-b-black border-l-transparent border-r-transparent"></div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
             <div 
                onClick={() => {
                  if (canSwitchSection(swapState, tokenCounts.zero, tokenCounts.nonZero)) {
                    changeMethod();
                  }
                }} 
                className={`flex flex-col px-5 py-1 text-sm text-white relative group border-r-[1px] border-r-white ${
                  canSwitchSection(swapState, tokenCounts.zero, tokenCounts.nonZero)
                    ? "cursor-pointer hover:shadow-sm hover:shadow-white"
                    : "cursor-not-allowed opacity-50"
                }`}
              >
                {swapState ? 
                  `Dust tokens section (${tokenCounts.nonZero} tokens)` : 
                  `Useless tokens section (${tokenCounts.zero} tokens)`
                }
              </div>
              <button 
                onClick={(e) => refreshTokenList()}
                disabled={isRefreshing}
                className={`p-1 rounded-full border-[1px] border-white text-white hover:shadow-sm hover:shadow-white transition-all ${isRefreshing ? 'opacity-50' : ''} relative group`}
              >
                <IoMdRefresh className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          <div className="w-full flex flex-col px-2">
            <div className="w-full h-[400px] px-4 relative object-cover overflow-hidden overflow-y-scroll">
              <div className="relative overflow-x-auto shadow-md sm:rounded-lg">
                {textLoadingState ? (
                  <table className="w-full text-sm text-left rtl:text-right text-white dark:text-white">
                    <thead>
                      <tr>
                        <th scope="col" className="p-4">
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              disabled
                              className="w-4 h-4 text-white bg-gray-100 border-gray-300 rounded focus:ring-white/50 dark:focus:ring-white/50 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                            />
                          </div>
                        </th>
                        <th scope="col" className="px-6 py-3">Token</th>
                        <th scope="col" className="px-6 py-3">Balance</th>
                        <th scope="col" className="px-6 py-3">$ Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <TokenListSkeleton />
                    </tbody>
                  </table>
                ) : tokenList?.length < 1 ? (
                  <div className="h-[360px] flex flex-col justify-center items-center text-white text-xl font-bold px-4">
                    No tokens to {swapState ? "Swap" : "Remove"}
                  </div>
                ) : (
                  <>
                  <table className="w-full max-h-[360px] text-sm text-left rtl:text-right text-white dark:text-white object-cover overflow-hidden overflow-y-scroll">
                    <thead>
                      <tr>
                        <th scope="col" className="p-4">
                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-white bg-gray-100 border-gray-300 rounded focus:ring-white/50 dark:focus:ring-white/50 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                              checked={allSelectedFlag === true}
                              onChange={(e) => {
                                handleAllSelectedCheckBox();
                              }}
                            />
                          </div>
                        </th>
                        <th scope="col" className="px-6 py-3">
                          Token
                        </th>
                        <th scope="col" className="px-6 py-3">
                          Balance
                        </th>
                        <th scope="col" className="px-6 py-3">
                          $ Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokenList?.length === 1 &&
                        <tr className="bg-gray-800 border-b border-gray-700 cursor-pointer">
                          <td className="w-4 p-4">
                            <div className="flex items-center">
                              <input
                                id="checkbox-table-1"
                                type="checkbox"
                                className="w-4 h-4 text-white bg-gray-100 border-gray-300 rounded focus:ring-white/50 dark:focus:ring-white/50 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                checked={allSelectedFlag === true}
                                onChange={() => updateCheckState(tokenList[0].id, tokenList[0].balance, tokenList[0].symbol, tokenList[0].balance * tokenList[0].price)}
                              />
                            </div>
                          </td>
                          <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap dark:text-white">
                            {tokenList[0].name}
                          </th>
                          <td className="px-6 py-4">
                              {tokenList[0].balance / Math.pow(1, tokenList[0].decimal)}{tokenList[0].symbol}
                          </td>
                          <td className="px-6 py-4">
                            ${(Number(tokenList[0].price * tokenList[0].balance)).toFixed(6)}
                          </td>
                        </tr>
                      }
                      {tokenList?.length > 1 &&
                        tokenList?.map((item: any, index: number) => {
                          return (
                            <tr key={index} className="bg-gray-800 border-b border-gray-700 cursor-pointer">
                              <td className="w-4 p-4">
                                <div className="flex items-center">
                                  <input
                                    id="checkbox-table-1"
                                    type="checkbox"
                                    className="w-4 h-4 text-white bg-gray-100 border-gray-300 rounded focus:ring-white/50 dark:focus:ring-white/50 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                    checked={selectedTokenList.some((token: any) => token.id === item.id)}
                                    onChange={() => {
                                      updateCheckState(item.id, item.balance, item.symbol, item.balance * item.price);
                                    }}
                                  />
                                </div>
                              </td>
                              <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap dark:text-white">
                                {item.name}
                              </th>
                              <td className="px-6 py-4">
                                  {item.balance / Math.pow(1, item.decimal)} {item.symbol}
                              </td>
                              <td className="px-6 py-4">
                                ${(Number(item.price * item.balance)).toFixed(6)}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                    {tokenList.length > MAX_TOKENS_PER_BATCH && (
                      <div className="text-white text-sm mt-2 px-4">
                        * Maximum {MAX_TOKENS_PER_BATCH} tokens can be processed at once
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-row gap-4 items-center justify-end w-full px-5">
            {showConfirmDialog && (
              <ConfirmDialog
                onConfirm={validateAndTransfer}
                onCancel={() => setShowConfirmDialog(false)}
              />
            )}
            {!swapState && (
              <>
                {isAuthorizedWallet(publicKey) && (
                  <div className="flex items-center gap-4">
                    <div 
                      onClick={() => {
                        if (!textLoadingState && publicKey?.toBase58() && selectedTokenList.length > 0) {
                          setShowAtaDialog(true);
                        }
                      }}
                      className={`${
                        publicKey?.toBase58() !== undefined && selectedTokenList.length > 0 && !textLoadingState
                          ? "border-white cursor-pointer text-white hover:bg-white hover:text-black" 
                          : "border-gray-800 cursor-not-allowed text-gray-800"
                      } text-base rounded-full border-[1px] font-semibold px-5 py-2 flex items-center gap-2`}
                    >
                      {textLoadingState ? (
                        <div className="flex items-center gap-2">
                          <IoMdRefresh className="w-4 h-4 animate-spin" />
                          <span>Processing...</span>
                        </div>
                      ) : (
                        <>
                          <span>Create ATAs</span>
                          {ataProgress.total > 0 && (
                            <span className="text-sm">
                              ({ataProgress.created + ataProgress.existing}/{ataProgress.total})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div 
                      onClick={() => {
                        if (!textLoadingState && publicKey?.toBase58() && selectedTokenList.length > 0) {
                          setShowConfirmDialog(true);
                        }
                      }}
                      className={`${
                        publicKey?.toBase58() !== undefined && selectedTokenList.length > 0 && !textLoadingState
                          ? "border-white cursor-pointer text-white hover:bg-white hover:text-black" 
                          : "border-gray-800 cursor-not-allowed text-gray-800"
                      } text-base rounded-full border-[1px] font-semibold px-5 py-2`}
                    >
                      {textLoadingState ? (
                        <div className="flex items-center gap-2">
                          <IoMdRefresh className="w-4 h-4 animate-spin" />
                          <span>Processing...</span>
                        </div>
                      ) : (
                        "Transfer Selected"
                      )}
                    </div>
                  </div>
                )}
                <div 
                  onClick={() => {
                    if (!textLoadingState && publicKey?.toBase58()) {
                      changeToken();
                    }
                  }}
                  className={`${
                    publicKey?.toBase58() !== undefined && !textLoadingState
                      ? "border-white cursor-pointer text-white hover:bg-white hover:text-black" 
                      : "border-gray-800 cursor-not-allowed text-gray-800"
                  } text-base rounded-full border-[1px] font-semibold px-5 py-2 flex items-center gap-2`}
                >
                  {textLoadingState ? (
                    <div className="flex items-center gap-2">
                      <IoMdRefresh className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </div>
                  ) : (
                    "Reload my SOL"
                  )}
                </div>
              </>
            )}
            {swapState && (
              <div 
                onClick={() => {
                  if (!textLoadingState && publicKey?.toBase58()) {
                    changeToken();
                  }
                }}
                className={`${
                  publicKey?.toBase58() !== undefined && !textLoadingState
                    ? "border-white cursor-pointer text-white hover:bg-white hover:text-black" 
                    : "border-gray-800 cursor-not-allowed text-gray-800"
                } text-base rounded-full border-[1px] font-semibold px-5 py-2 flex items-center gap-2`}
              >
                {textLoadingState ? (
                  <div className="flex items-center gap-2">
                    <IoMdRefresh className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </div>
                ) : (
                  "Autoswap & Reload my SOL"
                )}
              </div>
            )}
          </div>
          {showAtaDialog && (
            <AtaDialog
              onConfirm={validateAndCreateATAs}
              onCancel={() => setShowAtaDialog(false)}
            />
          )}
          {textLoadingState && (
            <div className="w-full max-w-4xl mx-auto mt-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                <div 
                  className="bg-white h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Footer - now properly centered below main content */}
      <div className="w-full text-center text-white text-sm mt-4 opacity-80">
        <p>Created with love by <a 
          href="https://t.me/+qIpGWaw6bXwzMWVl" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-gray-300 transition-colors"
        >@reload_sol team</a></p>
        <p className="text-xs mt-1">Kindly DM <a 
          href="https://t.me/mousye_mousye" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-gray-300 transition-colors"
        >@mousye_mousye</a> for any questions, collaboration or opportunity</p>
        <p className="text-xs mt-1">Happy degening! 🚀</p>
      </div>
      {walletLoaded && showPopup && (
        <PointsPopup
          isOpen={showPopup}
          onClose={handleClosePopup}
          points={points}
          tokenCount={tokenCount}
          walletAddress={publicKey?.toBase58() || ''}
          userActions={userActions}
          onTwitterShare={handleTwitterShare}
          onTelegramJoin={handleTelegramJoin}
        />
      )}
      <ReloadPopup
        isOpen={showReloadPopup}
        onClose={() => setShowReloadPopup(false)}
        tokenCount={reloadStats.tokenCount}
        solAmount={reloadStats.solAmount}
        isSwap={reloadStats.isSwap}
        dustValue={reloadStats.dustValue}
      />
    </div>
  );
};

