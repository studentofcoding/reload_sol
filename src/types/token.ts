import { MetadataAccountData } from '@metaplex-foundation/mpl-token-metadata';

// Add Jupiter price response interfaces
export interface JupiterPriceData {
  id: string;
  type: string;
  price: string;
}

export interface JupiterPriceResponse {
  data: Record<string, JupiterPriceData>;
  timeTaken: number;
}

export interface TokenInfo {
    id: string;
    balance: number;
    name: string;
    symbol: string;
    price: number;
    decimal: number;
    mint: string;
  }
  
  export interface TokenCache {
    data: TokenInfo;
    timestamp: number;
  }
  
  export interface TokenData {
    mint: string;
    metadata: MetadataAccountData;
    decimals: number;
  }