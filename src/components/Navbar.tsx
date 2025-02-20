"use client"
import React, { useContext, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import UserContext from "@/contexts/usercontext";
import {
  successAlert,
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
} from '@solana/web3.js';
// import { sleep } from "@/utils/sleep";
import axios from "axios";

const SLIPPAGE = 20;

export default function Home() {
  const { tokenList, setTokenList, selectedTokenList, setSelectedTokenList, setSwapTokenList, setTextLoadingState, setLoadingText, swapState, setSwapState, setTokeBalance } = useContext<any>(UserContext);
  const wallet = useWallet();
  const { publicKey } = wallet;
  const [allSelectedFlag, setAllSelectedFlag] = useState<boolean | null>(false);

  useEffect(() => {

  }, [tokenList]);

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

  const Swap = async (selectedTokens: SeletedTokens[]) => {
    setLoadingText("Simulating swap...");
    setTextLoadingState(true);
    console.log('selected tokens ===> ', selectedTokens)

    try {
      const solConnection = new Connection(String(process.env.NEXT_PUBLIC_SOLANA_RPC), "confirmed")
      let transactionBundle: VersionedTransaction[] = [];


      // Transaction construct
      for (let i = 0; i < selectedTokens.length; i++) {

        const mintAddress = selectedTokens[i].id;
        const symbol = selectedTokens[i].symbol;
        const decimal = selectedTokens[i].decimal;
        const value = selectedTokenList[i].value * Math.pow(10, 9);

        const amount = selectedTokens[i].amount * Math.pow(10, decimal);

        if (publicKey === null) {
          continue;
        }

        const addressStr = publicKey?.toString();
        console.log("🚀 ~ Swap ~ addressStr:", addressStr)

        // await sleep(10);
        // try {
        const quoteResponse = await (
          await fetch(
            `https://quote-api.jup.ag/v6/quote?inputMint=${mintAddress}&outputMint=${NATIVE_MINT.toBase58()}&amount=${amount.toString()}&slippageBps=${SLIPPAGE.toString()}`
          )
        ).json();

        if (quoteResponse.error && wallet.publicKey) {
          const ata = await getAssociatedTokenAddress(new PublicKey(mintAddress), wallet.publicKey)
          const burnIx = createBurnCheckedInstruction(ata, new PublicKey(mintAddress), wallet.publicKey, amount, decimal)
          console.log(`    ✅ - Burn Instruction Created`);
          const { blockhash, lastValidBlockHeight } = await solConnection.getLatestBlockhash('finalized');
          const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: [burnIx]
          }).compileToV0Message();
          const burnTx = new VersionedTransaction(messageV0);
          console.log("🚀 ~ Swap ~ burnTx:", burnTx)
          transactionBundle.push(burnTx);
        }

        console.log("🚀 ~ Swap ~ quoteResponse:", quoteResponse)

        // get serialized transactions for the swap
        // await sleep(i * 100 + 50);
        const { swapTransaction } = await (
          await fetch("https://quote-api.jup.ag/v6/swap", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              quoteResponse,
              userPublicKey: addressStr,
              wrapAndUnwrapSol: true,
              dynamicComputeUnitLimit: true,
              prioritizationFeeLamports: "auto"
            }),
          })
        ).json();

        const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
        const transaction = VersionedTransaction.deserialize(swapTransactionBuf as any);

        transaction.message.recentBlockhash = (await solConnection.getLatestBlockhash()).blockhash
        transactionBundle.push(transaction);

        const ixs: TransactionInstruction[] = []
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

        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        const solPriceInUSD = response.data.solana.usd;

        const feeIx = SystemProgram.transfer({
          fromPubkey: wallet.publicKey, // Sender's public key
          toPubkey: devWallet,         // Recipient's public key
          lamports: Math.floor(value / (2 * solPriceInUSD)),         // Amount to transfer in lamports
        });

        ixs.push(feeIx);

        const blockhash = (await solConnection.getLatestBlockhash()).blockhash
        const messageV0 = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash,
          instructions: ixs,

        }).compileToV0Message();

        const feeTx = new VersionedTransaction(messageV0);
        transactionBundle.push(feeTx);
      }

      const blockhash = (await solConnection.getLatestBlockhash()).blockhash
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
      for (let j = 0; j < signedTxs.length; j += 3) {
        // Create a new promise for each outer loop iteration
        const batchPromise = (async () => {
          let success = true; // Assume success initially
          for (let k = j; k < j + 3 && k < signedTxs.length; k++) {
            try {
              const tx = signedTxs[k]; // Get transaction
              const latestBlockhash = await solConnection.getLatestBlockhash(); // Fetch the latest blockhash

              console.log(await solConnection.simulateTransaction(tx, { sigVerify: true }));

              // Send the transaction
              const sig = await solConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

              console.log("🚀 ~ batchPromise ~ sig:", sig)
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
                if ((Math.floor(j / 3) + 1) === selectedTokens.length) {
                  // Token accounts loop ended here, 1 ~ 3 times calls
                  setLoadingText("");
                  setTextLoadingState(false);
                }
                break; // Exit the inner loop if there's an error
              } else {
                // Success handling with a switch statement
                switch (k % 3) { // Using k % 3 to get index in the current group of 3
                  case 0:
                    console.log(`Success in ${Math.floor(j / 3)}nd swap transaction: https://solscan.io/tx/${sig}`);
                    console.log(`swapped token id ===> ${selectedTokens[Math.floor(j / 3)].id} `,)
                    swappedTokenNotify(selectedTokens[Math.floor(j / 3)].id);
                    if ((Math.floor(j / 3) + 1) === selectedTokens.length) {
                      // Token accounts loop ended here, 1 ~ 3 times calls
                      setLoadingText("");
                      setTextLoadingState(false);
                    }
                    break;
                  case 1:
                    console.log(`Success in ${Math.floor(j / 3)}nd close transaction: https://solscan.io/tx/${sig}`);
                    console.log(`closed token id ===> ${selectedTokens[Math.floor(j / 3)].id} `,)
                    break;
                  default:
                    console.log(`Success in ${Math.floor(j / 3)}nd ata swap transaction: https://solscan.io/tx/${sig}`);
                    console.log(`ata swapped token id ===> ${selectedTokens[Math.floor(j / 3)].id} `,)
                    swappedTokenNotify(selectedTokens[Math.floor(j / 3)].id);
                    break;
                }
              }
            } catch (error) {
              console.error(`Error occurred during ${k}th transaction processing: `, error);
              success = false; // Mark success as false
              if ((Math.floor(j / 3) + 1) === selectedTokens.length) {
                // Token accounts loop ended here, 1 ~ 3 times calls
                setLoadingText("");
                setTextLoadingState(false);
              }
              break; // Exit the inner loop if an error occurs
            }
          }

          // Optional: Log if this batch of transactions was a success or failure
          if (!success) {
            console.log(`Batch starting with index ${j} failed.`);
          } else if ((Math.floor(j / 3) + 1) === selectedTokens.length) {
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
      successAlert("Swaping success");
    } catch (err) {
      console.log("error during swap and close account ===> ", err);
      setLoadingText("");
      setTextLoadingState(false);
    }
  }

  const CloseAndFee = async (selectedTokens: SeletedTokens[]) => {
    setLoadingText("Simulating account close...");
    setTextLoadingState(true);
    console.log('selected tokens in beta mode ===> ', selectedTokens)
    console.log('output mint in beta mode ===> ', String(process.env.NEXT_PUBLIC_MINT_ADDRESS))

    try {
      const solConnection = new Connection(String(process.env.NEXT_PUBLIC_SOLANA_RPC), "confirmed")
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
          const blockhash = (await solConnection.getLatestBlockhash()).blockhash
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

      const blockhash = (await solConnection.getLatestBlockhash()).blockhash
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
      successAlert("Close success");
    } catch (err) {
      console.log("error during swap and close account in beta mode ===> ", err);
      setLoadingText("");
      setTextLoadingState(false);
    }
  }

  const updateCheckState = (id: string, amount: number, symbol: string, value: number, decimal: number) => {
    if (selectedTokenList.some((_token: any) => _token.id === id)) {
      // If the token exists, remove it from the selected list
      setSelectedTokenList(selectedTokenList.filter((_token: any) => _token.id != id));
      setAllSelectedFlag(false);
    } else {
      // Otherwise, add the token to the selected list
      const updatedList = [...selectedTokenList, { id, amount, symbol, value, decimal }];
      setSelectedTokenList(updatedList);

      let _allSelectedToken: { id: string, amount: number, symbol: string, value: number, decimal: number }[] = [...updatedList];

      selectedTokenList.forEach((element: any) => {
        if (!_allSelectedToken.some((token: any) => token.id === element.id)) {
          _allSelectedToken.push({
            id: element.id,
            amount: element.amount,
            symbol: element.symbol,
            value: element.value,
            decimal: element.decimal
          });
        }
      });
    }
  };

  const handleAllSelectedCheckBox = () => {
    if (allSelectedFlag === false) {
      // If no items are selected, select all
      let _selectedToken: { id: String, amount: number, symbol: String, value: number, decimal: number }[] = [];
      tokenList.forEach((token: any) => {
        _selectedToken.push({ id: token.id, amount: token.balance, symbol: token.symbol, value: token.price * token.balance, decimal: token.decimal });
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

  const swappedTokenNotify = async (mintAddress: string) => {
    let newTokenList: any[] = [];

    newTokenList = await tokenList.filter((item: { id: string; }) => item.id !== mintAddress);
    setTokenList(newTokenList)
  }

  const changeMethod = () => {
    setSwapState(!swapState)
    setSelectedTokenList([])
  }

  type SeletedTokens = {
    id: string;
    amount: number,
    symbol: string,
    value: number,
    decimal: number
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
                                onChange={() => updateCheckState(tokenList[0].id, tokenList[0].balance, tokenList[0].symbol, tokenList[0].balance * tokenList[0].price, tokenList[0].decimal)}
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
                                      updateCheckState(item.id, item.balance, item.symbol, item.balance * item.price, item.decimal);
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

