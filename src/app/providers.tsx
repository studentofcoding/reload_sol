"use client";
import React, { ReactNode } from "react";
import UserContext from "@/contexts/usercontext";
import { SolanaWalletProvider } from "@/contexts/SolanaWalletProvider";
import { QueryClientProvider, QueryClient } from "react-query";

const queryClient = new QueryClient();

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [tokenList, setTokenList] = React.useState<any>([]);
  const [tokenFilterList, setTokenFilterList] = React.useState<any>([]);
  const [selectedTokenList, setSelectedTokenList] = React.useState<any>([]);
  const [swapTokenList, setSwapTokenList] = React.useState<any>([]);
  const [currentAmount, setCurrentAmount] = React.useState<number>(10000)
  const [loadingState, setLoadingState] = React.useState<boolean>(false);
  const [textLoadingState, setTextLoadingState] = React.useState<boolean>(false);
  const [loadingText, setLoadingText] = React.useState<string>("")
  const [tokeBalance, setTokeBalance] = React.useState<number>(0);
  const [swapState, setSwapState] = React.useState<boolean>(false)

  return (
    <SolanaWalletProvider>
      <UserContext.Provider value={{ 
        tokenList, 
        setTokenList, 
        loadingState, 
        setLoadingState, 
        tokenFilterList, 
        setTokenFilterList, 
        selectedTokenList, 
        setSelectedTokenList, 
        currentAmount, 
        setCurrentAmount, 
        swapTokenList, 
        setSwapTokenList, 
        textLoadingState, 
        setTextLoadingState, 
        loadingText, 
        setLoadingText, 
        tokeBalance, 
        setTokeBalance, 
        swapState, 
        setSwapState 
      }}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </UserContext.Provider>
    </SolanaWalletProvider>
  );
}
