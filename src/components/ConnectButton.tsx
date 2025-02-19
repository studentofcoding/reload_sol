"use client";
import axios from "axios";
import { FC, useContext, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowLine, ExitIcon, WalletIcon } from "./SvgIcon";
import { walletScan } from "@/utils/walletScan";
import UserContext from "@/contexts/usercontext";
import {
  errorAlert
} from "@/components/Toast";
import { Connection, PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { MetadataAccountData, MetadataAccountDataArgs, getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { getPdaMetadataKey } from "@raydium-io/raydium-sdk";

const ConnectButton: FC = () => {
  const { tokenList, setTokenList, setLoadingState, currentAmount, setTokenFilterList, setTokeBalance, swapState } = useContext<any>(UserContext);
  const { setVisible } = useWalletModal();
  const { publicKey, disconnect } = useWallet();

  useEffect(() => {
    if (publicKey?.toBase58() !== "" && publicKey?.toBase58() !== undefined) {
      if (swapState) {
        getTokenList(publicKey.toBase58());
      } else {
        getTokenListInBeta(publicKey.toBase58());
      }
      getWalletTokeBalance();
    }
  }, [publicKey, swapState])

  useEffect(() => {
    if (tokenList !== undefined) {
      // filterData()
    }
  }, [tokenList, currentAmount])

  const getTokenInfo = async (address: string) => {
    const solanaConnection = new Connection(String(process.env.NEXT_PUBLIC_SOLANA_RPC));

    const tokenAccounts = await solanaConnection.getParsedTokenAccountsByOwner(new PublicKey(address), {
      programId: TOKEN_PROGRAM_ID,
    });
    const tokenMints = await Promise.all(
      tokenAccounts.value.map(async (account) => {
        try {
          const mint = account.account.data.parsed.info.mint; // Extract mint address
          const tokenAmount = account.account.data.parsed.info.tokenAmount.uiAmount; // Extract token balance

          const mintPublicKey = new PublicKey(mint);
          const priceRes = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`)
          const priceData = await priceRes.json();

          // Get price data for the specific token
          const price = priceData.data[mint]?.price || 0;

          console.log("🚀 ~ tokenAccounts.value.map ~ price:", price)
          const metadataPDA = getPdaMetadataKey(mintPublicKey);
          const metadataAccount = await solanaConnection.getAccountInfo(metadataPDA.publicKey);

          if (!metadataAccount?.data) {
            return { ok: false, message: 'Mutable -> Failed to fetch account data' };
          }
          const serializer = getMetadataAccountDataSerializer()
          const deserialize = serializer.deserialize(metadataAccount.data as any);
          const mintInfo = await getMint(solanaConnection, mintPublicKey);

          // Extract name and symbol from metadata
          const name = deserialize[0]?.name;
          const symbol = deserialize[0]?.symbol;

          return { id: mint, balance: tokenAmount, name, symbol, price, decimal: mintInfo.decimals };
          // Return mint, balance, name, and symbol
        } catch (error) {
          console.error("Failed to fetch metadata for mint:", account.account.data.parsed.info.mint, error);

          // Return data without name and symbol in case of error
          return {
            mint: account.account.data.parsed.info.mint,
            balance: account.account.data.parsed.info.tokenAmount.uiAmount,
            name: 'Unknown',
            symbol: 'Unknown',
          };
        }
      })
    );
    return tokenMints;
  }

  const getTokenList = async (address: string) => {
    setLoadingState(true); // Set loading state to true before the async operation
    console.log("get token list");

    try {
      const tokenMints = await getTokenInfo(address);

      const validTokens = tokenMints.filter((token) => token !== null && token.balance > 0);

      console.log("🚀 Token Data:", validTokens);
      setTokenList(validTokens);

    } catch (err) {
      console.log("ERROR:", err);
      errorAlert(err); // Display error alert
    } finally {
      setLoadingState(false); // Ensure loading state is reset in all cases
    }
  };

  const getTokenListInBeta = async (address: string) => {
    setLoadingState(true)
    console.log('/getTokenListInBeta url calling ... ')
    try {
      const tokenMints = await getTokenInfo(address);

      const validTokens = tokenMints.filter((token) => token !== null && token.balance == 0);

      setTokenList(validTokens);
    } catch (err) {
      console.log("ERROR : ", err)
      errorAlert(err)
    }
    setLoadingState(false)
  }

  const getWalletTokeBalance = async () => {
    if (publicKey === null) {
      return;
    }
    const tokeAmount = await walletScan(publicKey?.toString());
    console.log('toke amount ===> ', tokeAmount)
    setTokeBalance(tokeAmount);
  }

  return (
    <div className="rounded-lg border-[0.75px] border-primary-300 bg-primary-200 shadow-btn-inner text-primary-100 tracking-[0.32px] py-2 px-2 w-[140px] lg:w-[180px] group relative cursor-pointer">
      {publicKey ? (
        <>
          <div className="flex items-center justify-center text-[12px] lg:text-[16px]">
            {publicKey.toBase58().slice(0, 4)}....
            {publicKey.toBase58().slice(-4)}
            <div className="rotate-90 w-3 h-3">
              <ArrowLine />
            </div>
          </div>
          <div className="w-[200px] absolute right-0 top-10 hidden group-hover:block">
            <ul className="border-[0.75px] border-[#89C7B5] rounded-lg bg-[#162923] p-2 mt-2">
              <li>
                <button
                  className="flex gap-2 items-center text-primary-100 tracking-[-0.32px]"
                  onClick={() => setVisible(true)}
                >
                  <WalletIcon /> Change Wallet
                </button>
              </li>
              <li>
                <button
                  className="flex gap-2 items-center text-primary-100 tracking-[-0.32px]"
                  onClick={disconnect}
                >
                  <ExitIcon /> Disconnect
                </button>
              </li>
            </ul>
          </div>
        </>
      ) : (
        <div
          className="flex items-center justify-center gap-1 text-[12px] lg:text-[16px]"
          onClick={() => setVisible(true)}
        >
          Connect wallet <ArrowLine />
        </div>
      )}
    </div>
  );
};

export default ConnectButton;
