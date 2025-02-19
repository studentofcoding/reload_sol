declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NEXT_PUBLIC_SOLANA_RPC: string;
      NEXT_PUBLIC_RECIPIENT_WALLET: string;
      // ... other env variables
    }
  }
}

export {}; 