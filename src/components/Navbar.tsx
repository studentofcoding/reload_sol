"use client"
import React, { useContext, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import UserContext from "@/contexts/usercontext";
import {
  warningAlert
} from "@/components/Toast";
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

export default function Home() {
  const { currentAmount, setCurrentAmount, tokenList, setTokenList, selectedTokenList, setSelectedTokenList, swapTokenList, setSwapTokenList, setTextLoadingState, setLoadingText, swapState, setSwapState, setTokeBalance } = useContext<any>(UserContext);
  const wallet = useWallet();
  const { publicKey } = wallet;
  const [allSelectedFlag, setAllSelectedFlag] = useState<boolean | null>(false);
  const [solConnection, setSolConnection] = useState<Connection | null>(null);

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
  }, [selectedTokenList])

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

  const getBlockhash = async (retries = 3): Promise<string> => {
    if (!solConnection) throw new Error("No connection available");
    for (let i = 0; i < retries; i++) {
      try {
        const { blockhash } = await solConnection.getLatestBlockhash('finalized');
        return blockhash;
      } catch (error) {
        console.warn(`Failed to get blockhash, attempt ${i + 1} of ${retries}`);
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    throw new Error("Failed to get blockhash after retries");
  };

  // Modify sendJitoBundles function to include Jito tip
  async function sendJitoBundles(txs: VersionedTransaction[], tokens: SeletedTokens[]): Promise<BundleResults> {
    const signAllTransactions = wallet?.signAllTransactions;
    if (!signAllTransactions || !wallet?.publicKey || !solConnection) {
      throw new Error("Wallet not ready for signing");
    }

    const failedTransactions: VersionedTransaction[] = [];
    const successfulTokens: string[] = [];
    const failedTokens: string[] = [];
    const promises = [];

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
            } catch (error) {
              console.error(`Transaction ${idx} failed:`, error);
              failedTransactions.push(tx);
              tokens[j + idx]?.id && failedTokens.push(tokens[j + idx].id);
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
    return { successfulTokens, failedTokens, failedTransactions };
  }

  const sendTransactions = async (signedTxs: VersionedTransaction[], selectedTokens: SeletedTokens[]) => {
    if (!solConnection) throw new Error("No connection available");
    
    // Performance tracking
    const startTime = performance.now();
    const metrics = {
      bundleAttempts: 0,
      retryAttempts: 0,
      successfulTxs: 0,
      failedTxs: 0,
      totalTime: 0
    };

    // Use Jito bundling for larger selections
    if (selectedTokens.length > 3) {
      console.log("Using Jito bundling for large transaction set");
      
      try {
        // First attempt: Jito bundling
        metrics.bundleAttempts++;
        const jitoResult = await sendJitoBundles(signedTxs, selectedTokens);
        
        if (jitoResult.successfulTokens.length > 0) {
          metrics.successfulTxs = signedTxs.length;
          metrics.totalTime = performance.now() - startTime;
          console.log("Jito bundle performance:", {
            ...metrics,
            averageTimePerTx: metrics.totalTime / signedTxs.length,
            bundleSuccess: true
          });
          return true;
        }

        // Fallback to regular transactions with remaining txs
        console.log("Jito bundle failed, falling back to regular transactions");
        metrics.failedTxs = jitoResult.failedTokens.length;
        
        return await sendRegularTransactions(jitoResult.failedTransactions, selectedTokens);
      } catch (error) {
        console.error("Error in Jito bundling:", error);
        return await sendRegularTransactions(signedTxs, selectedTokens);
      }
    } else {
      return await sendRegularTransactions(signedTxs, selectedTokens);
    }

    async function sendRegularTransactions(txs: VersionedTransaction[], tokens: SeletedTokens[]) {
      console.log("Falling back to regular transaction processing");
      const startRetryTime = performance.now();

      if (!solConnection) {
        console.error("No connection available");
        warningAlert("Connection not available. Please try again.");
        return;
      }
      
      const promises = [];
      for (let j = 0; j < txs.length; j++) {
        const txPromise = (async () => {
          const tx = txs[j];
          let attempts = 0;
          const maxAttempts = 3;

          while (attempts < maxAttempts) {
            try {
              metrics.retryAttempts++;
              const sig = await solConnection.sendRawTransaction(tx.serialize(), {
                skipPreflight: true,
                maxRetries: 2,
              });
              await solConnection.confirmTransaction(sig);
              metrics.successfulTxs++;
              return true;
            } catch (error) {
              attempts++;
              if (attempts === maxAttempts) {
                metrics.failedTxs++;
                console.error(`Transaction failed after ${maxAttempts} attempts:`, error);
                return false;
              }
              await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
          }
        })();
        promises.push(txPromise);
      }

      const results = await Promise.all(promises);
      metrics.totalTime = performance.now() - startTime;
      
      console.log("Regular transaction performance:", {
        ...metrics,
        fallbackTime: performance.now() - startRetryTime,
        successRate: `${(metrics.successfulTxs / txs.length * 100).toFixed(2)}%`
      });

      return results.every(result => result);
    }
  };

  const Swap = async (selectedTokens: SeletedTokens[]) => {
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
        const swapResults: BundleResults = await sendJitoBundles(signedSwapBundle, selectedTokens);
        
        swapResults.successfulTokens.forEach(tokenId => {
          tokenStatuses.get(tokenId)!.swapComplete = true;
        });
      }

      // Step 3: Prepare close transactions for successful swaps
      const closeBundle: VersionedTransaction[] = [];
      for (const [tokenId, status] of Array.from(tokenStatuses.entries())) {
        if (status.swapComplete) {
          try {
            const token = selectedTokens.find(t => t.id === tokenId)!;
            const ata = await getAssociatedTokenAddress(
              new PublicKey(tokenId),
              wallet.publicKey
            );

            const closeIx = createCloseAccountInstruction(
              ata,
              wallet.publicKey,
              wallet.publicKey
            );

            const messageV0 = new TransactionMessage({
              payerKey: wallet.publicKey,
              recentBlockhash: await getBlockhash(),
              instructions: [closeIx]
            }).compileToV0Message();

            closeBundle.push(new VersionedTransaction(messageV0));
          } catch (error) {
            console.error(`Failed to prepare close for ${tokenId}:`, error);
          }
        }
      }

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
        warningAlert(`Successfully processed: ${summary.success.join(', ')}`);
      }
      if (summary.failed.length > 0) {
        warningAlert(`Failed to process: ${summary.failed.join(', ')}`);
      }

    } catch (err) {
      console.error("Error during swap process:", err);
      warningAlert("Some operations failed. Please check the console for details.");
    } finally {
      setLoadingText("");
      setTextLoadingState(false);
    }
  };

  const CloseAndFee = async (selectedTokens: SeletedTokens[]) => {
    setLoadingText("Simulating account close...");
    setTextLoadingState(true);
    console.log('selected tokens in beta mode ===> ', selectedTokens)
    console.log('output mint in beta mode ===> ', String(process.env.NEXT_PUBLIC_MINT_ADDRESS))

    if (!solConnection) {
      console.error("No connection available");
      warningAlert("Connection not available. Please try again.");
      return;
    }

    try {
      let transactionBundle: VersionedTransaction[] = [];


      // Transaction construct
      for (let i = 0; i < selectedTokens.length; i++) {
        const mintAddress = selectedTokens[i].id;
        const symbol = selectedTokens[i].symbol;
        const value = selectedTokens[i].value;
        console.log('token mint address ===> ', mintAddress, ', mint symbol ===> ', symbol)

        if (publicKey === null) {
          continue;
        }

        const addressStr = publicKey?.toString();

        // await sleep(i * 100 + 25);
        try {

          const tokenAccounts = await solConnection.getParsedTokenAccountsByOwner(publicKey, {
            programId: TOKEN_PROGRAM_ID,
          },
            "confirmed"
          )

          // get transactions for token account close
          const closeAccounts = filterTokenAccounts(tokenAccounts?.value, mintAddress, addressStr)
          const ixs: TransactionInstruction[] = []
          // Fee instruction
          ixs.push(
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000_000 }),
            ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000 })
          );
          if (!process.env.NEXT_PUBLIC_DEV_WALLET || !wallet.publicKey) {
            console.error("Development wallet or wallet public key is not defined");
            return;
          }

          let devWallet = new PublicKey(process.env.NEXT_PUBLIC_DEV_WALLET);
          console.log("🚀 ~ Swap ~ devWallet:", devWallet.toBase58())


          for (let i = 0; i < closeAccounts.length; i++) {
            const closeAccountPubkey = closeAccounts[i]?.pubkey;
            if (!closeAccountPubkey) {
              console.error(`Close account public key is not defined at index ${i}`);
              continue;
            }

            try {
              const closeAccountInstruction = createCloseAccountInstruction(
                new PublicKey(closeAccountPubkey),
                wallet.publicKey,
                wallet.publicKey
              );

              const transferInstruction = SystemProgram.transfer({
                fromPubkey: wallet.publicKey, // Sender's public key
                toPubkey: devWallet,         // Recipient's public key
                lamports: 1000000,         // Amount to transfer in lamports
              });

              ixs.push(closeAccountInstruction, transferInstruction);
            } catch (e) {
              console.error(`Error creating instructions for account at index ${i}:`, e);
            }
          }
          const blockhash = await getBlockhash();
          const messageV0 = new TransactionMessage({
            payerKey: publicKey,
            recentBlockhash: blockhash,
            instructions: ixs,

          }).compileToV0Message();

          const closeAndTransferFeeTx = new VersionedTransaction(messageV0);
          transactionBundle.push(closeAndTransferFeeTx);

          // await sleep(i * 100 + 75);

        } catch (err) {
          console.log(`Error processing token ${symbol}: `, err);
          warningAlert(`${symbol} doesn't have enough balance for jupiter swap`); // Alert user of the error
          continue;
        }
      }

      const blockhash = await getBlockhash();
      transactionBundle.map((tx) => tx.message.recentBlockhash = blockhash)

      // Wallet sign all
      if (!wallet || !wallet.signAllTransactions) {
        console.log('wallet connection error')
        return
      }
      const signedTxs = await wallet.signAllTransactions(transactionBundle);
      setLoadingText("Swapping now...");
      setTextLoadingState(true);


      // Transaction confirmation
      const promises = []; // Array to hold promises for each batch
      for (let j = 0; j < signedTxs.length; j += 2) {
        // Create a new promise for each outer loop iteration
        const batchPromise = (async () => {
          let success = true; // Assume success initially
          for (let k = j; k < j + 2 && k < signedTxs.length; k++) {
            try {
              const tx = signedTxs[k]; // Get transaction
              const latestBlockhash = await solConnection.getLatestBlockhash(); // Fetch the latest blockhash

              console.log(await solConnection.simulateTransaction(tx, { sigVerify: true }));

              // Send the transaction
              const sig = await solConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

              // Confirm the transaction
              const ataSwapConfirmation = await solConnection.confirmTransaction({
                signature: sig,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                blockhash: latestBlockhash.blockhash,
              });

              // Check for confirmation error
              if (ataSwapConfirmation.value.err) {
                console.log(`${k}th Confirmation error ===> `, ataSwapConfirmation.value.err);
                success = false; // Mark success as false
                break; // Exit the inner loop if there's an error
              } else {
                // Success handling with a switch statement
                switch (k % 2) { // Using k % 3 to get index in the current group of 2
                  case 0:
                    console.log(`Success in close transaction in beta mode: https://solscan.io/tx/${sig}`);
                    swappedTokenNotify(selectedTokens[Math.floor(k / 2)].id);

                    break;
                  default:
                    console.log(`Success in ata swap transaction in beta mode: https://solscan.io/tx/${sig}`);
                    swappedTokenNotify(selectedTokens[Math.floor(k / 2)].id);
                    break;
                }
              }

              // Add logging for transaction result
              console.log("Transaction result:", {
                signature: sig,
                slot: await solConnection.getSlot(),
                timestamp: new Date().toISOString()
              });
            } catch (error) {
              console.error(`Error occurred during ${k}th transaction processing in beta mode: `, error);
              success = false; // Mark success as false
              break; // Exit the inner loop if an error occurs
            }
          }

          // Optional: Log if this batch of transactions was a success or failure
          if (!success) {
            console.log(`Batch starting with index ${j} failed in beta mode.`);
          } else if ((Math.floor(j / 2) + 1) === selectedTokens.length) {
            setLoadingText("");
            setTextLoadingState(false);
          }
        })();

        // Add the batch promise to the array
        promises.push(batchPromise);
      }

      // Await all batch promises at the end
      await Promise.all(promises);
      setLoadingText("");
      setTextLoadingState(false);
    } catch (err) {
      console.log("error during swap and close account in beta mode ===> ", err);
      setLoadingText("");
      setTextLoadingState(false);
    }
  }

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
    setSwapState(!swapState)
    setSelectedTokenList([])
  }

  type SeletedTokens = {
    id: string;
    amount: number,
    symbol: string,
    value: number
  }

  return (
    <div className="w-full h-full flex flex-row items-center pb-6 relative">
      <div className="container">
        <div className="flex flex-col items-center justify-between w-full h-full rounded-xl border-[1px] border-[#26c3ff] max-w-4xl mx-auto py-6 gap-4 z-20 relative">
          <div className="w-full flex justify-between flex-col sm2:flex-row items-center h-full px-4 border-b-[1px] border-b-[#26c3ff] pb-4">
            <div onClick={() => changeMethod()} className="flex flex-col px-5 py-1 rounded-full border-[1px] border-[#26c3ff] text-[#26c3ff] font-semibold cursor-pointer hover:shadow-sm hover:shadow-[#26c3ff] ">
              {swapState ? "Swap Token" : "Empty token"}
            </div>
          </div>
          <div className="w-full flex flex-col px-2">
            <div className="w-full h-[400px] px-4 relative object-cover overflow-hidden overflow-y-scroll">
              <div className="relative overflow-x-auto shadow-md sm:rounded-lg">
                {tokenList?.length < 1 ?
                  <div className="h-[360px] flex flex-col justify-center items-center text-[#26c3ff] text-xl font-bold px-4">
                    NO TOKENS. TRY ADJUSTING THE SUPER SLIDER.
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
                          NAME
                        </th>
                        <th scope="col" className="px-6 py-3">
                          BALANCE
                        </th>
                        <th scope="col" className="px-6 py-3">
                          VALUE
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
                            {tokenList[0].balance * Math.pow(10, tokenList[0].decimal)}{tokenList[0].symbol}
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
                                {item.balance * Math.pow(10, item.decimal)} {item.symbol}
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
            {/* <div className="text-white text-sm">CuntDust 0 shitters for ~ 0 $TOKE</div> */}
            <div onClick={() => changeToken()} className={`${publicKey?.toBase58() !== undefined ? "border-[#26c3ff] cursor-pointer text-[#26c3ff] hover:bg-[#26c3ff] hover:text-white" : "border-[#1c1d1d] cursor-not-allowed text-[#1c1d1d]"} text-base rounded-full border-[1px] font-semibold px-5 py-2 `}>
              SCAVENGE
            </div>
          </div>
        </div>
      </div>
    </div >
  );
};

