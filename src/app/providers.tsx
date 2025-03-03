"use client";
import React, { ReactNode } from "react";
import UserContext from "@/contexts/usercontext";
import { SolanaWalletProvider } from "@/contexts/SolanaWalletProvider";
import { QueryClientProvider, QueryClient } from "react-query";

const queryClient = new QueryClient();

interface ProvidersProps {
  children: ReactNode;
}

interface LoadingState {
  tokenList: boolean;
  balance: boolean;
  swap: boolean;
  transfer: boolean;
}

export function Providers({ children }: ProvidersProps) {
  const [tokenList, setTokenList] = React.useState<any>([]);
  const [tokenFilterList, setTokenFilterList] = React.useState<any>([]);
  const [selectedTokenList, setSelectedTokenList] = React.useState<any>([]);
  const [swapTokenList, setSwapTokenList] = React.useState<any>([]);
  const [currentAmount, setCurrentAmount] = React.useState<number>(10000);
  const [textLoadingState, setTextLoadingState] = React.useState<boolean>(false);
  const [loadingText, setLoadingText] = React.useState<string>("");
  const [tokeBalance, setTokeBalance] = React.useState<number>(0);
  const [swapState, setSwapState] = React.useState<boolean>(false);
  const [loadingState, setLoadingState] = React.useState<LoadingState>({
    tokenList: false,
    balance: false,
    swap: false,
    transfer: false
  });

  const updateLoadingState = (key: keyof LoadingState, value: boolean) => {
    setLoadingState(prev => ({ ...prev, [key]: value }));
  };

  return (
    <SolanaWalletProvider>
      <UserContext.Provider value={{ 
        tokenList, 
        setTokenList, 
        loadingState,
        setLoadingState,
        updateLoadingState,
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
