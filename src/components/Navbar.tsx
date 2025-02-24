"use client"
import React, { useContext, useEffect, useState } from "react";
import { useWallet, WalletContextState } from "@solana/wallet-adapter-react";
import UserContext from "@/contexts/usercontext";
import { successAlert, warningAlert } from "@/components/Toast";
import { TOKEN_PROGRAM_ID, createCloseAccountInstruction, NATIVE_MINT, getMint, createBurnCheckedInstruction, getAssociatedTokenAddress } from "@solana/spl-token";
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
      console.log(`Connected to RPC: ${endpoint}`);
      return connection;
    } catch (error) {
      console.warn(`RPC ${endpoint} failed, trying next one...`);
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

  const changeToken = async () => {

    if (publicKey?.toBase58() === undefined || publicKey?.toBase58() === '') {
      warningAlert("please connect wallet")
      return;
    }
    if (selectedTokenList.length === 0) {
      warningAlert("You must select at least one token")
      return;
    } else {
      setSwapTokenList(selectedTokenList);
      if (swapState) {
        await Swap(selectedTokenList)
      } else {
        await CloseAndFee(selectedTokenList)
      }
    }
  }

  // const getBlockhash = async (retries = 3): Promise<string> => {
  //   if (!solConnection) throw new Error("No connection available");
  //   for (let i = 0; i < retries; i++) {
  //     try {
  //       const { blockhash } = await solConnection.getLatestBlockhash('finalized');
  //       return blockhash;
  //     } catch (error) {
  //       console.warn(`Failed to get blockhash, attempt ${i + 1} of ${retries}`);
  //       if (i === retries - 1) throw error;
  //       await new Promise(resolve => setTimeout(resolve, 1000));
  //     }
  //   }
  //   throw new Error("Failed to get blockhash after retries");
  // };

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

  // const sendTransactions = async (signedTxs: VersionedTransaction[], selectedTokens: SeletedTokens[]) => {
  //   if (!solConnection) throw new Error("No connection available");
    
  //   // Performance tracking
  //   const startTime = performance.now();
  //   const metrics = {
  //     bundleAttempts: 0,
  //     retryAttempts: 0,
  //     successfulTxs: 0,
  //     failedTxs: 0,
  //     totalTime: 0
  //   };

  //   // Use Jito bundling for larger selections
  //   if (selectedTokens.length > 3) {
  //     console.log("Using Jito bundling for large transaction set");
      
  //     try {
  //       // First attempt: Jito bundling
  //       metrics.bundleAttempts++;
  //       const jitoResult = await sendJitoBundles(signedTxs, selectedTokens);
        
  //       if (jitoResult.successfulTokens.length > 0) {
  //         metrics.successfulTxs = signedTxs.length;
  //         metrics.totalTime = performance.now() - startTime;
  //         console.log("Jito bundle performance:", {
  //           ...metrics,
  //           averageTimePerTx: metrics.totalTime / signedTxs.length,
  //           bundleSuccess: true
  //         });
  //         return true;
  //       }

  //       // Fallback to regular transactions with remaining txs
  //       console.log("Jito bundle failed, falling back to regular transactions");
  //       metrics.failedTxs = jitoResult.failedTokens.length;
        
  //       return await sendRegularTransactions(jitoResult.failedTransactions, selectedTokens);
  //     } catch (error) {
  //       console.error("Error in Jito bundling:", error);
  //       return await sendRegularTransactions(signedTxs, selectedTokens);
  //     }
  //   } else {
  //     return await sendRegularTransactions(signedTxs, selectedTokens);
  //   }

  //   async function sendRegularTransactions(txs: VersionedTransaction[], tokens: SeletedTokens[]) {
  //     console.log("Falling back to regular transaction processing");
  //     const startRetryTime = performance.now();

  //     if (!solConnection) {
  //       console.error("No connection available");
  //       warningAlert("Connection not available. Please try again.");
  //       return;
  //     }
      
  //     const promises = [];
  //     for (let j = 0; j < txs.length; j++) {
  //       const txPromise = (async () => {
  //         const tx = txs[j];
  //         let attempts = 0;
  //         const maxAttempts = 3;

  //         while (attempts < maxAttempts) {
  //           try {
  //             metrics.retryAttempts++;
  //             const sig = await solConnection.sendRawTransaction(tx.serialize(), {
  //               skipPreflight: true,
  //               maxRetries: 2,
  //             });
  //             await solConnection.confirmTransaction(sig);
  //             metrics.successfulTxs++;
  //             return true;
  //           } catch (error) {
  //             attempts++;
  //             if (attempts === maxAttempts) {
  //               metrics.failedTxs++;
  //               console.error(`Transaction failed after ${maxAttempts} attempts:`, error);
  //               return false;
  //             }
  //             await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
  //           }
  //         }
  //       })();
  //       promises.push(txPromise);
  //     }

  //     const results = await Promise.all(promises);
  //     metrics.totalTime = performance.now() - startTime;
      
  //     console.log("Regular transaction performance:", {
  //       ...metrics,
  //       fallbackTime: performance.now() - startRetryTime,
  //       successRate: `${(metrics.successfulTxs / txs.length * 100).toFixed(2)}%`
  //     });

  //     return results.every(result => result);
  //   }
  // };

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
            await updateTokenList(); // Update token list after success
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

        // Update UI based on results
        if (closeResults.successfulTokens.length > 0) {
          successAlert(`Successfully closed ${closeResults.successfulTokens.length} accounts`);
          await updateTokenList();
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
    if (selectedTokenList.some((_token: any) => _token.id === id)) {
      // If the token exists, remove it from the selected list
      setSelectedTokenList(selectedTokenList.filter((_token: any) => _token.id != id));
      setAllSelectedFlag(false);
    } else {
      // Otherwise, add the token to the selected list
      const updatedList = [...selectedTokenList, { id, amount, symbol, value }];
      setSelectedTokenList(updatedList);

      let _allSelectedToken: { id: string, amount: number, symbol: string, value: number }[] = [...updatedList];

      selectedTokenList.forEach((element: any) => {
        if (!_allSelectedToken.some((token: any) => token.id === element.id)) {
          _allSelectedToken.push({
            id: element.id,
            amount: element.amount,
            symbol: element.symbol,
            value: element.value,
          });
        }
      });
    }
  };


  const handleAllSelectedCheckBox = () => {
    if (allSelectedFlag === false) {
      // If no items are selected, select all
      let _selectedToken: { id: String, amount: number, symbol: String, value: number }[] = [];
      tokenList.forEach((token: any) => {
        _selectedToken.push({ id: token.id, amount: token.balance, symbol: token.symbol, value: token.price * token.balance });
      });

      // Set the selectedTokenList to the array of selected tokens
      setSelectedTokenList(_selectedToken);
      setAllSelectedFlag(true); // Set the state to "checked"
    } else if (allSelectedFlag === true) {
      // If all items are selected, deselect all
      setSelectedTokenList([]);
      setAllSelectedFlag(false); // Set the state to "unchecked"
    } else {
      // If it's indeterminate, clear the selection (or implement logic based on your needs)
      setSelectedTokenList([]);
      setAllSelectedFlag(false); // Move to "unchecked"
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
      forceRefreshTokens(); // Force cache refresh
      if (swapState) {
        await getTokenListMoreThanZero(publicKey.toString(), setTokenList, setTextLoadingState);
      } else {
        await getTokenListZeroAmount(publicKey.toString(), setTokenList, setTextLoadingState);
      }
      setSelectedTokenList([]);
      successAlert("Token list refreshed");
    } catch (error) {
      warningAlert("Failed to refresh token list");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-row items-center pb-6 relative">
      <div className="container">
        <div className="flex flex-col items-center justify-between w-full h-full rounded-xl border-[1px] border-[#26c3ff] max-w-4xl mx-auto py-6 gap-4 z-20 relative">
          <div className="w-full flex justify-between flex-col sm2:flex-row items-center h-full px-4 border-b-[1px] border-b-[#26c3ff] pb-4">
            <div className="flex items-center gap-4">
              <div 
                onClick={() => changeMethod()} 
                className="flex flex-col px-5 py-1 rounded-full border-[1px] border-[#26c3ff] text-[#26c3ff] font-semibold cursor-pointer hover:shadow-sm hover:shadow-[#26c3ff]"
              >
                {swapState ? 
                `Your dust section (${tokenCounts.nonZero} tokens)` : 
                `Your empty section (${tokenCounts.zero} tokens)`
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
                {tokenList?.length < 1 ?
                  <div className="h-[360px] flex flex-col justify-center items-center text-[#26c3ff] text-xl font-bold px-4">
                    No tokens to {swapState ? "Swap" : "Remove"}
                  </div>
                  :
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
                }
              </div>
            </div>
          </div>
          <div className="flex flex-row gap-4 items-center justify-end w-full px-5">
            <div onClick={() => changeToken()} className={`${publicKey?.toBase58() !== undefined ? "border-[#26c3ff] cursor-pointer text-[#26c3ff] hover:bg-[#26c3ff] hover:text-white" : "border-[#1c1d1d] cursor-not-allowed text-[#1c1d1d]"} text-base rounded-full border-[1px] font-semibold px-5 py-2 `}>
              {swapState ? "Autoswap & Reload SOL" : "Reload SOL"}
            </div>
          </div>
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
    </div >
  );
};

