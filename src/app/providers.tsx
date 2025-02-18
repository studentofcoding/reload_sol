"use client";
import React, { ReactNode, useState } from "react";
import UserContext from "@/contexts/usercontext";
import { SolanaWalletProvider } from "@/contexts/SolanaWalletProvider";
import { QueryClientProvider, QueryClient } from "react-query";

const queryClient = new QueryClient();

export default function Providers({ children }: { children: ReactNode }) {
  const [tokenList, setTokenList] = useState<any>([]);
  const [tokenFilterList, setTokenFilterList] = useState<any>([]);
  const [selectedTokenList, setSelectedTokenList] = useState<any>([]);
  const [swapTokenList, setSwapTokenList] = useState<any>([]);
  const [currentAmount, setCurrentAmount] = useState<number>(10000)
  const [loadingState, setLoadingState] = useState<boolean>(false);
  const [textLoadingState, setTextLoadingState] = useState<boolean>(false);
  const [loadingText, setLoadingText] = useState<string>("")
  const [tokeBalance, setTokeBalance] = useState<number>(0);
  const [swapState, setSwapState] = useState<boolean>(false)

  return (
    <SolanaWalletProvider>
      <UserContext.Provider value={{ tokenList, setTokenList, loadingState, setLoadingState, tokenFilterList, setTokenFilterList, selectedTokenList, setSelectedTokenList, currentAmount, setCurrentAmount, swapTokenList, setSwapTokenList, textLoadingState, setTextLoadingState, loadingText, setLoadingText, tokeBalance, setTokeBalance, swapState, setSwapState }}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </UserContext.Provider>

    </SolanaWalletProvider>
  );
}
