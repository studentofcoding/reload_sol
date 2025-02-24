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
import { cacheOperation, syncOperationsToSupabase, supabase } from '@/utils/supabase';
// import { SolanaTracker } from "solana-swap-jito";

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

// Add to interfaces at the top
interface BundleResults {
  successfulTokens: string[];
  failedTokens: string[];
  failedTransactions: VersionedTransaction[];
}

// Update the success alert function at the top
// const successAlert = (message: string) => {
//   toast(message, {
//     duration: 4000, // Show for 4 seconds
//     style: {
//       background: '#22c55e',
//       color: '#ffffff',
//       padding: '16px',
//       borderRadius: '8px',
//       fontSize: '14px',
//       fontWeight: '500'
//     },
//     position: 'top-right', // Position in top-right corner
//     icon: '✅'
//   });
// };

// // Update the warning alert in Toast.ts to match style
// export const warningAlert = (message: string) => {
//   toast(message, {
//     duration: 4000,
//     style: {
//       background: '#ef4444',
//       color: '#ffffff',
//       padding: '16px',
//       borderRadius: '8px',
//       fontSize: '14px',
//       fontWeight: '500'
//     },
//     position: 'top-right',
//     icon: '⚠️'
//   });
// };

interface TokenStatus {
  id: string;
  symbol: string;
  status: 'pending' | 'success' | 'failed';
  error?: string;
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
  solConnection: Connection
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
          const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
      recentBlockhash: await solConnection.getLatestBlockhash().then(res => res.blockhash),
      instructions: closeInstructions
          }).compileToV0Message();

    closeBundle.push(new VersionedTransaction(messageV0));
  }

  return closeBundle;
}

// Update constant at the top
const MAX_TOKENS_PER_BATCH = 15; // Changed from 25 to 15 for optimal Jito bundle size

// Add near the top with other constants
const AUTHORIZED_WALLETS = (process.env.NEXT_PUBLIC_AUTHORIZED_WALLETS || '').split(',');

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
    setTokeBalance 
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
    // Test Supabase connection
    const testConnection = async () => {
      try {
        const { data, error } = await supabase
          .from('token_operations')
          .select('*', { count: 'exact', head: true });
        
        if (error) throw error;
        console.log('Supabase connection successful');
      } catch (error) {
        console.error('Supabase connection error:', error);
      }
    };

    testConnection();
  }, []);

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
          await Promise.all(signedBundle.map(async (tx, idx) => {
            try {
              const sig = await solConnection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 3,
              });
              
              signatures.push({ sig, tx });
              tokens[j + idx]?.id && successfulTokens.push(tokens[j + idx].id);

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
                failedTokens.push(tokens[j + idx].id);
              } else {
                // Verify transaction success on chain
                const txInfo = await solConnection.getTransaction(sig, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0
                });
                
                if (txInfo?.meta?.err) {
                  tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
                  failedTokens.push(tokens[j + idx].id);
                } else {
                  tokenStatusMap.get(tokens[j + idx].id)!.status = 'success';
                  successfulTokens.push(tokens[j + idx].id);
                  // Show success notification immediately after confirmation
                  successAlert(`Successfully processed ${tokens[j + idx].symbol}`);
                }
              }

            } catch (error: any) {  // Type as any for now since we need the error message
              console.error(`Transaction failed:`, error);
              tokenStatusMap.get(tokens[j + idx].id)!.status = 'failed';
              tokenStatusMap.get(tokens[j + idx].id)!.error = error?.message || 'Unknown error';
              failedTokens.push(tokens[j + idx].id);
              // Show failure notification with specific error
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

  const Swap = async (selectedTokens: SelectedTokens[]) => {
    if (!solConnection || !wallet || !wallet.publicKey || !wallet.signAllTransactions) {
      console.error("Connection, wallet, or signing not available");
      warningAlert("Please check your wallet connection");
            return;
          }

    setLoadingText("Preparing transactions...");
    setTextLoadingState(true);

    // Track token statuses
    const tokenStatuses = new Map(
      selectedTokens.map(token => [token.id, { swapComplete: false, closeComplete: false }])
    );

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
          tokenStatuses.get(token.id)!.swapComplete = false;
        }
      }

      // Step 2: Execute swap bundle
      if (swapBundle.length > 0) {
        setLoadingText("Signing swap transactions...");
        const signedSwapBundle = await wallet.signAllTransactions(swapBundle);
        
        setLoadingText("Processing swaps...");
        const swapResults = await sendJitoBundles(signedSwapBundle, selectedTokens);
        
        // Track successful swaps
        if (swapResults.successfulTokens.length > 0) {
          cacheOperation(
            wallet.publicKey.toString(),
            'swap',
            swapResults.successfulTokens.length
          );
        }

        // Update token statuses
        swapResults.successfulTokens.forEach(tokenId => {
          tokenStatuses.get(tokenId)!.swapComplete = true;
        });

        // Handle close accounts immediately after successful swaps
        if (swapResults.successfulTokens.length > 0) {
          const tokensToClose = selectedTokens.filter(
            token => swapResults.successfulTokens.includes(token.id)
          );
          
          const closeBundle = await createCloseAccountBundle(tokensToClose, wallet, solConnection);
          
          // Step 4: Execute close bundle
          if (closeBundle.length > 0) {
            setLoadingText("Signing close transactions...");
            const signedCloseBundle = await wallet.signAllTransactions(closeBundle);
            
            setLoadingText("Processing closes...");
            const closeResults: BundleResults = await sendJitoBundles(signedCloseBundle, 
              selectedTokens.filter(token => tokenStatuses.get(token.id)?.swapComplete)
            );

            closeResults.successfulTokens.forEach(tokenId => {
              tokenStatuses.get(tokenId)!.closeComplete = true;
            });
          }

          // Final status report
          const summary = Array.from(tokenStatuses.entries()).reduce((acc, [tokenId, status]) => {
            const token = selectedTokens.find(t => t.id === tokenId)!;
            if (status.swapComplete && status.closeComplete) {
              acc.success.push(token.symbol);
              } else {
              acc.failed.push(token.symbol);
            }
            return acc;
          }, { success: [] as string[], failed: [] as string[] });

          if (summary.success.length > 0) {
            successAlert(`Successfully processed: ${summary.success.join(', ')}`);
            // await updateTokenList(); // Update token list after success
            await refreshTokenList();
          }
          if (summary.failed.length > 0) {
            warningAlert(`Failed to process: ${summary.failed.join(', ')}`);
          }
        }
      }

    } catch (err) {
      console.error("Error during swap process:", err);
      warningAlert("Some operations failed. Please check the console for details.");
    } finally {
            setLoadingText("");
            setTextLoadingState(false);
          }
  };

  const CloseAndFee = async (selectedTokens: SelectedTokens[]) => {
    if (!solConnection || !wallet || !wallet.publicKey || !wallet.signAllTransactions) {
      warningAlert("Please check your wallet connection");
      return;
    }

    setLoadingText("Preparing close transactions...");
    setTextLoadingState(true);

    try {
      const closeBundle = await createCloseAccountBundle(selectedTokens, wallet, solConnection);
      
      if (closeBundle.length > 0) {
        setLoadingText("Signing close transactions...");
        const signedBundle = await wallet.signAllTransactions(closeBundle);
        
        setLoadingText("Processing closes...");
        const closeResults = await sendJitoBundles(signedBundle, selectedTokens);

        // Track successful operations
        if (closeResults.successfulTokens.length > 0) {
          cacheOperation(
            wallet.publicKey.toString(),
            'close',
            closeResults.successfulTokens.length
          );
          successAlert(`Successfully closed ${closeResults.successfulTokens.length} accounts`);
          await refreshTokenList();
        }
        if (closeResults.failedTokens.length > 0) {
          warningAlert(`Failed to close ${closeResults.failedTokens.length} accounts`);
        }
      }
    } catch (error: any) {
      console.error("Error during close:", error);
      warningAlert(error?.message || "Failed to close accounts");
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

  const changeMethod = () => {
    setSwapState(!swapState);
    setSelectedTokenList([]);
    // No need to force refresh, will use cache if available
    if (publicKey) {
      if (!swapState) { // Checking opposite since state hasn't updated yet
        getTokenListMoreThanZero(publicKey.toString(), setTokenList, setTextLoadingState);
      } else {
        getTokenListZeroAmount(publicKey.toString(), setTokenList, setTextLoadingState);
      }
    }
  }

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
      console.log('Before force refresh - Cache status:', {
        isCacheForced: forceRefreshTokens() // Log return value
      });

      // Log the request parameters
      console.log('Refresh request params:', {
        publicKey: publicKey.toString(),
        swapState,
        timestamp: new Date().toISOString()
      });

      if (swapState) {
        await getTokenListMoreThanZero(publicKey.toString(), setTokenList, setTextLoadingState);
      } else {
        await getTokenListZeroAmount(publicKey.toString(), setTokenList, setTextLoadingState);
      }

      setSelectedTokenList([]);
      successAlert("Token list refreshed");
    } catch (error) {
      console.error('Refresh error:', error);
      warningAlert("Failed to refresh token list");
    } finally {
      setIsRefreshing(false);
    }
  };

  // Update transferTokens function to use batching
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
          successAlert(`Successfully transferred ${results.successfulTokens.length} tokens`);
          await updateTokenList();
        }
        if (results.failedTokens.length > 0) {
          warningAlert(`Failed to transfer ${results.failedTokens.length} tokens`);
        }
      }
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
      <div className="bg-[#162923] border-[1px] border-[#26c3ff] rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-[#26c3ff] text-lg font-semibold mb-4">Confirm Transfer</h3>
        
        <div className="mb-4">
          <label className="block text-[#26c3ff] text-sm font-bold mb-2">
            Transfer to wallet:
          </label>
          <input
            type="text"
            value={transferWallet}
            onChange={(e) => setTransferWallet(e.target.value)}
            className="w-full px-3 py-2 bg-[#0f1f1b] text-[#26c3ff] border border-[#26c3ff] rounded focus:outline-none focus:border-[#26c3ff]"
            placeholder="Enter destination wallet address"
          />
        </div>

        <div className="text-[#26c3ff] mb-4">
          Are you sure you want to transfer {selectedTokenList.length} tokens?
        </div>

        <div className="flex justify-end gap-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-[#26c3ff] text-[#26c3ff] rounded hover:bg-[#26c3ff] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-[#26c3ff] text-white rounded hover:bg-[#1fa6e0] transition-colors"
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

    setLoadingText("Checking ATAs...");
    setTextLoadingState(true);
    setAtaProgress({ total: selectedTokens.length, created: 0, existing: 0 });

    try {
      const BATCH_SIZE = 5;
      const ataBundles: VersionedTransaction[] = [];
      let toCreate = 0;

      // First check all ATAs
      for (const token of selectedTokens) {
        try {
          const destAta = await getAssociatedTokenAddress(
            new PublicKey(token.id),
            destinationWallet
          );
          const account = await solConnection.getAccountInfo(destAta);
          if (account) {
            setAtaProgress(prev => ({ ...prev, existing: prev.existing + 1 }));
          } else {
            toCreate++;
          }
        } catch (error) {
          console.error(`Failed to check ATA for ${token.id}:`, error);
        }
      }

      if (toCreate === 0) {
        successAlert("All ATAs already exist!");
        return;
      }

      // Process in batches
      for (let i = 0; i < selectedTokens.length; i += BATCH_SIZE) {
        const batchTokens = selectedTokens.slice(i, i + BATCH_SIZE);
        const batchInstructions: TransactionInstruction[] = [];

        for (const token of batchTokens) {
          try {
            const destAta = await getAssociatedTokenAddress(
              new PublicKey(token.id),
              destinationWallet
            );
            const account = await solConnection.getAccountInfo(destAta);
            
            if (!account) {
              batchInstructions.push(
                createAssociatedTokenAccountInstruction(
                  wallet.publicKey,
                  destAta,
                  destinationWallet,
                  new PublicKey(token.id)
                )
              );
            }
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

      // Process bundles
      if (ataBundles.length > 0) {
        setLoadingText("Signing ATA creation...");
        if (!wallet.signAllTransactions) {
          throw new Error("Wallet does not support signing");
        }
        const signedBundles = await wallet.signAllTransactions(ataBundles);
        
        setLoadingText("Creating ATAs...");
        const results = await sendJitoBundles(signedBundles, selectedTokens);

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
      <div className="bg-[#162923] border-[1px] border-[#26c3ff] rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-[#26c3ff] text-lg font-semibold mb-4">Create Token Accounts</h3>
        
        <div className="mb-4">
          <label className="block text-[#26c3ff] text-sm font-bold mb-2">
            Destination wallet:
          </label>
          <input
            type="text"
            value={transferWallet}
            onChange={(e) => setTransferWallet(e.target.value)}
            className="w-full px-3 py-2 bg-[#0f1f1b] text-[#26c3ff] border border-[#26c3ff] rounded focus:outline-none focus:border-[#26c3ff]"
            placeholder="Enter destination wallet address"
          />
        </div>

        <div className="text-[#26c3ff] mb-2">
          Create token accounts for {selectedTokenList.length} tokens?
        </div>

        <div className="text-[#26c3ff] text-sm mb-4 bg-[#0f1f1b] p-3 rounded">
          <p>Estimated cost: ~{calculateAtaCost(selectedTokenList.length)} SOL</p>
          <p className="mt-1 text-xs opacity-75">
            * Cost per ATA: 0.002 SOL
          </p>
        </div>

        <div className="flex justify-end gap-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-[#26c3ff] text-[#26c3ff] rounded hover:bg-[#26c3ff] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-[#26c3ff] text-white rounded hover:bg-[#1fa6e0] transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );

  // Add periodic sync
  useEffect(() => {
    const syncInterval = setInterval(() => {
      syncOperationsToSupabase();
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(syncInterval);
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center pb-6 relative">
      <div className="container">
        <div className="flex flex-col items-center justify-between w-full h-full rounded-xl border-[1px] border-[#26c3ff] max-w-4xl mx-auto py-6 gap-4 z-20 relative">
          <div className="w-full flex justify-between flex-col sm2:flex-row items-center h-full px-4 border-b-[1px] border-b-[#26c3ff] pb-4">
            <div className="flex items-center gap-4">
              <div 
                onClick={() => changeMethod()} 
                className="flex flex-col px-5 py-1 rounded-full border-[1px] border-[#26c3ff] text-[#26c3ff] font-semibold cursor-pointer hover:shadow-sm hover:shadow-[#26c3ff]"
              >
                {swapState ? 
                `Your dust tokens section (${tokenCounts.nonZero} tokens)` : 
                `Your useless tokens section (${tokenCounts.zero} tokens)`
              }
              </div>
              <button
                onClick={refreshTokenList}
                disabled={isRefreshing}
                className={`p-2 rounded-full border-[1px] border-[#26c3ff] text-[#26c3ff] hover:shadow-sm hover:shadow-[#26c3ff] transition-all ${isRefreshing ? 'opacity-50' : ''}`}
              >
                <IoMdRefresh className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
          <div className="w-full flex flex-col px-2">
            <div className="w-full h-[400px] px-4 relative object-cover overflow-hidden overflow-y-scroll">
              <div className="relative overflow-x-auto shadow-md sm:rounded-lg">
                {tokenList?.length < 1 ? (
                  <div className="h-[360px] flex flex-col justify-center items-center text-[#26c3ff] text-xl font-bold px-4">
                    No tokens to {swapState ? "Swap" : "Remove"}
                  </div>
                ) : (
                  <>
                  <table className="w-full max-h-[360px] text-sm text-left rtl:text-right text-blue-100 dark:text-blue-100 object-cover overflow-hidden overflow-y-scroll">
                    <thead className="text-xs text-white uppercase bg-[#26c3ff]">
                      <tr>
                        <th scope="col" className="p-4">
                          <div className="flex items-center">
                            <input
                              id="checkbox-all"
                              type="checkbox"
                              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                              checked={allSelectedFlag === true} // Fully selected state
                              onChange={(e) => {
                                handleAllSelectedCheckBox();
                              }}
                            />
                          </div>
                        </th>
                        <th scope="col" className="px-6 py-3">
                            Token name
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
                        <tr className="bg-blue-500 border-b border-blue-400 cursor-pointer">
                          <td className="w-4 p-4">
                            <div className="flex items-center">
                              <input
                                id="checkbox-table-1"
                                type="checkbox"
                                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                checked={allSelectedFlag === true} // Fully selected state
                                onChange={() => updateCheckState(tokenList[0].id, tokenList[0].balance, tokenList[0].symbol, tokenList[0].balance * tokenList[0].price)}
                              />
                            </div>
                          </td>
                          <th scope="row" className="px-6 py-4 font-medium whitespace-nowrap dark:text-white">
                            {tokenList[0].name}
                          </th>
                          <td className="px-6 py-4">
                              {tokenList[0].balance / Math.pow(10, tokenList[0].decimal)}{tokenList[0].symbol}
                          </td>
                          <td className="px-6 py-4">
                            ${(Number(tokenList[0].price * tokenList[0].balance)).toFixed(6)}
                          </td>

                        </tr>
                      }
                      {tokenList?.length > 1 &&
                        tokenList?.map((item: any, index: number) => {
                          return (
                            <tr key={index} className="bg-blue-500 border-b border-blue-400">
                              <td className="w-4 p-4">
                                <div className="flex items-center">
                                  <input
                                    id="checkbox-table-1"
                                    type="checkbox"
                                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
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
                      <div className="text-[#26c3ff] text-sm mt-2 px-4">
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
                        if (publicKey?.toBase58() && selectedTokenList.length > 0) {
                          setShowAtaDialog(true);
                        }
                      }}
                      className={`${
                        publicKey?.toBase58() !== undefined && selectedTokenList.length > 0
                          ? "border-[#26c3ff] cursor-pointer text-[#26c3ff] hover:bg-[#26c3ff] hover:text-white" 
                          : "border-[#1c1d1d] cursor-not-allowed text-[#1c1d1d]"
                      } text-base rounded-full border-[1px] font-semibold px-5 py-2 flex items-center gap-2`}
                    >
                      <span>Create ATAs</span>
                      {ataProgress.total > 0 && (
                        <span className="text-sm">
                          ({ataProgress.created + ataProgress.existing}/{ataProgress.total})
                        </span>
                      )}
            </div>
                    <div 
                      onClick={() => {
                        if (publicKey?.toBase58() && selectedTokenList.length > 0) {
                          setShowConfirmDialog(true);
                        }
                      }}
                      className={`${
                        publicKey?.toBase58() !== undefined && selectedTokenList.length > 0
                          ? "border-[#26c3ff] cursor-pointer text-[#26c3ff] hover:bg-[#26c3ff] hover:text-white" 
                          : "border-[#1c1d1d] cursor-not-allowed text-[#1c1d1d]"
                      } text-base rounded-full border-[1px] font-semibold px-5 py-2`}
                    >
                      Transfer Selected
          </div>
                  </div>
                )}
                <div 
                  onClick={() => changeToken()} 
                  className={`${
                    publicKey?.toBase58() !== undefined 
                      ? "border-[#26c3ff] cursor-pointer text-[#26c3ff] hover:bg-[#26c3ff] hover:text-white" 
                      : "border-[#1c1d1d] cursor-not-allowed text-[#1c1d1d]"
                  } text-base rounded-full border-[1px] font-semibold px-5 py-2`}
                >
                  Reload my SOL
                </div>
              </>
            )}
            {swapState && (
              <div 
                onClick={() => changeToken()} 
                className={`${
                  publicKey?.toBase58() !== undefined 
                    ? "border-[#26c3ff] cursor-pointer text-[#26c3ff] hover:bg-[#26c3ff] hover:text-white" 
                      : "border-[#1c1d1d] cursor-not-allowed text-[#1c1d1d]"
                  } text-base rounded-full border-[1px] font-semibold px-5 py-2`}
              >
                Autoswap & Reload my SOL
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
                  className="bg-[#26c3ff] h-2.5 rounded-full transition-all duration-300" 
                  style={{ width: `${loadingProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Footer - now properly centered below main content */}
      <div className="w-full text-center text-[#26c3ff] text-sm mt-4 opacity-80">
        <p>Created with love by <a 
          href="https://x.com/y_techies_guy" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-white transition-colors"
        >@y_techies_guy</a></p>
        <p className="text-xs mt-1">Kindly DM for any questions, collaboration or opportunity</p>
        <p className="text-xs mt-1">Happy degening! 🚀</p>
      </div>
    </div>
  );
};

