import React from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import Image from 'next/image';

interface TokenInfo {
  mint: string;
  balance: bigint;
  account: string;
  selected: boolean;
  symbol?: string;
  name?: string;
  logoURI?: string;
  decimals?: number;
  price?: number;
  value?: number;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
}

interface GMGnTokenInfo {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  price: number;
  tags?: string[];
  extensions?: {
    coingeckoId?: string;
    website?: string;
    twitter?: string;
  };
}

interface CachedMetadata {
  data: GMGnTokenInfo;
  timestamp: number;
  retryCount: number;
}

interface TokenCache {
  [key: string]: CachedMetadata;
}

class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private requestsPerSecond: number;

  constructor(requestsPerSecond: number = 1) {
    this.requestsPerSecond = requestsPerSecond;
  }

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const fn = this.queue.shift();
    if (fn) {
      await fn();
      await new Promise(resolve => setTimeout(resolve, 1000 / this.requestsPerSecond));
    }

    await this.processQueue();
  }
}

const STORAGE_KEYS = {
  TOKEN_CACHE: 'token_metadata_cache',
  SELECTED_TOKENS: 'selected_tokens',
  TOKEN_SETTINGS: 'token_settings'
} as const;

class TokenMetadataCache {
  private cache: TokenCache = {};
  private readonly maxRetries: number = 3;
  private readonly cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private readonly rateLimiter: RateLimiter;

  constructor() {
    this.rateLimiter = new RateLimiter(1);
    this.loadFromStorage();
  }

  private getLocalStorage() {
    if (typeof window !== 'undefined') {
      return window.localStorage;
    }
    return null;
  }

  private loadFromStorage() {
    try {
      const storage = this.getLocalStorage();
      if (storage) {
        const stored = storage.getItem(STORAGE_KEYS.TOKEN_CACHE);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (this.isValidCache(parsed)) {
            this.cache = parsed;
          }
        }
      }
    } catch (error) {
      console.warn('Error loading cache from storage:', error);
      // Continue with empty cache
      this.cache = {};
    }
  }

  private saveToStorage() {
    try {
      const storage = this.getLocalStorage();
      if (storage) {
        storage.setItem(STORAGE_KEYS.TOKEN_CACHE, JSON.stringify(this.cache));
      }
    } catch (error) {
      console.warn('Error saving cache to storage:', error);
    }
  }

  private isValidCache(data: any): data is TokenCache {
    return typeof data === 'object' && Object.values(data).every(item => 
      item && 
      typeof item.timestamp === 'number' && 
      typeof item.retryCount === 'number' &&
      item.data && 
      typeof item.data.address === 'string'
    );
  }

  async getMetadata(mintAddress: string): Promise<GMGnTokenInfo | null> {
    const now = Date.now();
    const cached = this.cache[mintAddress];

    if (cached && now - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    let retryCount = 0;
    while (retryCount < this.maxRetries) {
      try {
        const data = await this.rateLimiter.add(async () => {
          if (!navigator.onLine) {
            throw new Error('offline');
          }

          const response = await fetch(`/api/token/${mintAddress}`);
          if (!response.ok) {
            throw new Error('API request failed');
          }

          return await response.json();
        });

        this.cache[mintAddress] = {
          data,
          timestamp: now,
          retryCount: 0
        };
        
        this.saveToStorage();
        return data;
      } catch (error) {
        retryCount++;
        if (error.message === 'offline' || retryCount === this.maxRetries) {
          console.error(`Failed to fetch metadata for ${mintAddress}${error.message === 'offline' ? ' (offline)' : ''}`);
          return cached?.data || null;
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }

    return null;
  }

  clearExpiredCache() {
    const now = Date.now();
    let changed = false;
    Object.keys(this.cache).forEach(key => {
      if (now - this.cache[key].timestamp > this.cacheExpiry) {
        delete this.cache[key];
        changed = true;
      }
    });
    if (changed) {
      this.saveToStorage();
    }
  }
}

const rateLimiter = new RateLimiter(2); // Changed from 1 to 2 requests per second
const tokenCache = new TokenMetadataCache();

// Update interfaces to match API response
interface TokenResponse {
  token: {
    name: string;
    symbol: string;
    mint: string;
    decimals: number;
    image: string;
    description?: string;
    twitter?: string;
    website?: string;
  };
  pools: Array<{
    price: {
      usd: number | null;
    };
    market: string;
  }>;
}

// Update RPC rate limiter to handle 2 requests per second
class RPCRateLimiter {
  private static instance: RPCRateLimiter;
  private lastCall: number = 0;
  private readonly minInterval: number = 500; // Changed from 1000 to 500ms (2 requests per second)

  private constructor() {}

  static getInstance(): RPCRateLimiter {
    if (!RPCRateLimiter.instance) {
      RPCRateLimiter.instance = new RPCRateLimiter();
    }
    return RPCRateLimiter.instance;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeToWait = this.lastCall + this.minInterval - now;
    
    if (timeToWait > 0) {
      await new Promise(resolve => setTimeout(resolve, timeToWait));
    }
    
    this.lastCall = Date.now();
    return fn();
  }
}

// Add new interface for token cache
interface TokenCacheData {
  metadata: {
    [mintAddress: string]: {
      data: TokenResponse;
      timestamp: number;
    }
  };
  lastKnownTokens: {
    [walletAddress: string]: {
      tokens: TokenInfo[];
      timestamp: number;
    }
  };
}

// Add a helper function to serialize BigInt
const serializeBigInt = (obj: any): any => {
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
    );
  }
  return obj;
};

// Update the deserialization logic to force string conversion
const deserializeBigInt = (obj: any): any => {
  if (Array.isArray(obj)) {
    return obj.map(deserializeBigInt);
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => {
        if (key === 'balance' && typeof value === 'string') {
          return [key, BigInt(value)];
        }
        // Convert PublicKey-like objects to strings
        if ((key === 'mint' || key === 'account') && value && typeof value === 'object') {
          try {
            return [key, new PublicKey(value._bn).toBase58()];
          } catch {
            return [key, value.toString()];
          }
        }
        return [key, deserializeBigInt(value)];
      })
    );
  }
  return obj;
};

// Add helper function at the top level
const toPublicKey = (key: string | PublicKey): PublicKey => {
  return typeof key === 'string' ? new PublicKey(key) : key;
};

// Update the getMintAddress helper to only handle strings
const getMintAddress = (mint: string): string => mint;

// Add type guard function to check if value is PublicKey
const isPublicKey = (value: any): value is PublicKey => {
  return value instanceof PublicKey;
};

// Add new interface for basic token info
interface BasicTokenInfo {
  mint: string;
  balance: bigint;
  account: string;
  selected: boolean;
  loading?: boolean;
}

// Add helper function to calculate total value
const calculateTotalValue = (tokens: TokenInfo[]): number => {
  return tokens
    .filter(token => !token.loading && token.value !== undefined)
    .reduce((total, token) => total + (token.value || 0), 0);
};

// Add error handling constants
const RATE_LIMIT_ERROR = 429;
const RETRY_DELAY = 5000; // 5 seconds

export function SwapWidget() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [tokens, setTokens] = React.useState<TokenInfo[]>([]);
  const [selectAll, setSelectAll] = React.useState(true);
  const [isOnline, setIsOnline] = React.useState(true);
  const rpcLimiter = React.useRef(RPCRateLimiter.getInstance());
  const [tokenCache, setTokenCache] = React.useState<TokenCacheData>({
    metadata: {},
    lastKnownTokens: {}
  });
  const [isMounted, setIsMounted] = React.useState(false);
  const [tokenCounter, setTokenCounter] = React.useState(0);
  const [showValue, setShowValue] = React.useState(true);

  // Load cache on mount
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    
    setIsMounted(true);
    try {
      const storage = localStorage;
      if (storage) {
        const stored = storage.getItem('token_metadata_cache');
        if (stored) {
          const parsedCache = JSON.parse(stored);
          const validCache: TokenCacheData = {
            metadata: parsedCache.metadata || {},
            lastKnownTokens: Object.fromEntries(
              Object.entries(parsedCache.lastKnownTokens || {}).map(([key, value]) => [
                key,
                {
                  ...value,
                  tokens: deserializeBigInt(value.tokens)
                }
              ])
            )
          };
          setTokenCache(validCache);
          
          if (publicKey) {
            const walletAddress = publicKey.toBase58();
            const cachedWalletData = validCache.lastKnownTokens[walletAddress];
            if (cachedWalletData && Date.now() - cachedWalletData.timestamp < 60 * 60 * 1000) {
              setTokens(cachedWalletData.tokens);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Error loading from storage:', error);
      setTokenCache({
        metadata: {},
        lastKnownTokens: {}
      });
    }
  }, [publicKey]);

  // Save cache when it changes
  React.useEffect(() => {
    if (isMounted && typeof window !== 'undefined') {
      try {
        const serializedCache = {
          ...tokenCache,
          lastKnownTokens: Object.fromEntries(
            Object.entries(tokenCache.lastKnownTokens).map(([key, value]) => [
              key,
              {
                ...value,
                tokens: serializeBigInt(value.tokens)
              }
            ])
          )
        };
        localStorage.setItem('token_metadata_cache', JSON.stringify(serializedCache));
      } catch (error) {
        console.error('Error saving to storage:', error);
      }
    }
  }, [tokenCache, isMounted]);

  // Monitor online status
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      setIsOnline(navigator.onLine);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  const fetchTokenMetadata = async (mintAddress: string) => {
    try {
      const now = Date.now();
      
      // Check cache first
      const cached = tokenCache.metadata[mintAddress];
      if (cached && now - cached.timestamp < 5 * 60 * 1000) {
        return cached.data;
      }

      // Add delay before API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      const response = await fetch(
        `https://data.solanatracker.io/tokens/${mintAddress}`,
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-key': process.env.NEXT_PUBLIC_API_KEY || ''
          }
        }
      );

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data: TokenResponse = await response.json();
      
      // Update cache immediately after successful fetch
      setTokenCache(prev => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          [mintAddress]: {
            data,
            timestamp: now
          }
        }
      }));

      return data;
    } catch (error) {
      console.error(`Error fetching metadata for ${mintAddress}:`, error);
      return null;
    }
  };

  const formatUSD = (value: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6
    }).format(value);
  };

  const formatBalance = (balance: bigint, decimals: number = 9): string => {
    const balanceStr = balance.toString().padStart(decimals + 1, '0');
    const decimalIndex = balanceStr.length - decimals;
    const wholeNumber = balanceStr.slice(0, decimalIndex) || '0';
    const decimal = balanceStr.slice(decimalIndex, decimalIndex + 4);
    return `${wholeNumber}.${decimal}`;
  };

  const calculateValue = (balance: bigint, decimals: number, price: number): number => {
    const balanceNum = Number(balance) / Math.pow(10, decimals);
    return balanceNum * price;
  };

  const fetchTokenAccounts = async () => {
    if (!publicKey) return;
    
    try {
      setStatus('Fetching token accounts...');
      
      const walletAddress = publicKey.toBase58();
      const cachedWalletData = tokenCache.lastKnownTokens[walletAddress];
      const now = Date.now();
      
      // Check cache first
      if (cachedWalletData?.tokens && now - (cachedWalletData.timestamp || 0) < 60 * 1000) {
        setTokens(cachedWalletData.tokens);
        setStatus('Loaded from cache');
        return;
      }

      // Batch RPC calls
      const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

      console.log('Found token accounts:', tokenAccounts.value.length);

      // First pass: Show basic token info
      const basicTokenInfos = tokenAccounts.value
        .map(account => {
          const accountData = AccountLayout.decode(account.account.data);
          const amount = BigInt(accountData.amount.toString());
          const mintAddress = new PublicKey(accountData.mint).toBase58();
          console.log('Processing account:', mintAddress, 'amount:', amount.toString());
          
          return {
            mint: mintAddress,
            balance: amount,
            account: account.pubkey.toBase58(),
            selected: true,
            loading: true,
            symbol: mintAddress.slice(0, 4) + '...',
            name: 'Loading...',
            decimals: 9,
          } as TokenInfo;
        })
        .filter(acc => acc.balance > BigInt(0));

      // Update UI with basic info
      setTokens(basicTokenInfos);
      setStatus(`Loading token metadata...`);

      // Second pass: Fetch metadata for each token
      for (let i = 0; i < basicTokenInfos.length; i++) {
        const token = basicTokenInfos[i];
        try {
          // Add delay between requests to respect rate limit
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          const tokenData = await fetchTokenMetadata(token.mint);
          if (tokenData?.token) {
            const activePool = tokenData.pools?.find(pool => 
              pool.price?.usd !== null && pool.price?.usd > 0
            );

            const price = activePool?.price?.usd || 0;
            const value = calculateValue(token.balance, tokenData.token.decimals || 9, price);

            // Update single token with full metadata
            setTokens(current => {
              const updatedTokens = [...current];
              const index = updatedTokens.findIndex(t => t.mint === token.mint);
              if (index !== -1) {
                updatedTokens[index] = {
                  ...updatedTokens[index],
                  loading: false,
                  symbol: tokenData.token.symbol || token.mint.slice(0, 4),
                  name: tokenData.token.name || 'Unknown Token',
                  logoURI: tokenData.token.image,
                  decimals: tokenData.token.decimals || 9,
                  price,
                  value,
                };
              }
              return updatedTokens;
            });
          }
        } catch (error: any) {
          console.error(`Error fetching metadata for ${token.mint}:`, error);
          
          // Handle rate limit error
          if (error?.status === RATE_LIMIT_ERROR || error?.message?.includes('429')) {
            setStatus(`Too many requests. Retrying in 5 seconds...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            
            // Retry this token
            i--; // Decrease counter to retry current token
            continue;
          }

          // Update token with error state
          setTokens(current => {
            const updatedTokens = [...current];
            const index = updatedTokens.findIndex(t => t.mint === token.mint);
            if (index !== -1) {
              updatedTokens[index] = {
                ...updatedTokens[index],
                loading: false,
                error: true,
                errorMessage: 'Failed to load metadata'
              };
            }
            return updatedTokens;
          });
        }
      }

      // Final update to cache
      setTokens(current => {
        const sortedTokens = [...current].sort((a, b) => (b.value || 0) - (a.value || 0));
        
        // Update cache with final token list
        setTokenCache(prev => ({
          ...prev,
          lastKnownTokens: {
            ...prev.lastKnownTokens,
            [walletAddress]: {
              tokens: sortedTokens,
              timestamp: now
            }
          }
        }));

        return sortedTokens;
      });

      setStatus('');
    } catch (error) {
      console.error('Error fetching token accounts:', error);
      setStatus('Failed to fetch token accounts');
    }
  };

  // Update useEffect to only fetch on publicKey change
  React.useEffect(() => {
    if (publicKey) {
      fetchTokenAccounts();
    }
  }, [publicKey]);

  // Update toggleToken to save selection
  const toggleToken = (mint: string | PublicKey) => {
    const mintAddress = getMintAddress(typeof mint === 'string' ? mint : mint.toBase58());
    setTokens(prev => {
      const updated = prev.map(token => 
        getMintAddress(token.mint) === mintAddress
          ? { ...token, selected: !token.selected }
          : token
      );
      return updated;
    });
  };

  // Update toggleSelectAll to save selection
  const toggleSelectAll = () => {
    setSelectAll(!selectAll);
    setTokens(prev => {
      const updated = prev.map(token => ({ ...token, selected: !selectAll }));
      return updated;
    });
  };

  const swapToken = async (tokenInfo: TokenInfo) => {
    if (!publicKey || !signTransaction) return;
    
    setLoading(true);
    try {
      const mintAddress = typeof tokenInfo.mint === 'string' 
        ? tokenInfo.mint 
        : tokenInfo.mint.toBase58();
        
      setStatus(`Swapping ${mintAddress}...`);
      
      const quoteResponse = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${mintAddress}` +
        `&outputMint=So11111111111111111111111111111111111111112` +
        `&amount=${tokenInfo.balance.toString()}` +
        `&slippageBps=50`
      ).then(res => res.json());

      const { swapTransaction } = await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: publicKey.toBase58(),
          wrapAndUnwrapSol: true,
        })
      }).then(res => res.json());

      const swapTx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
      if (signTransaction) {
        const signed = await signTransaction(swapTx);
        const txid = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(txid);
      }

      setStatus(`Successfully swapped ${mintAddress}`);
      await fetchTokenAccounts();
    } catch (error: any) {
      console.error(`Failed to swap token:`, error);
      setStatus(`Failed to swap: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoSwap = async () => {
    if (!publicKey) return;
    
    setLoading(true);
    try {
      const selectedTokens = tokens.filter(t => t.selected);
      
      for (const token of selectedTokens) {
        await swapToken(token);
      }
      
      setStatus('All selected tokens swapped');
    } finally {
      setLoading(false);
    }
  };

  // Update the maskValue function
  const maskValue = (value: number): string => {
    const valueStr = formatUSD(value); // First format as USD to get proper formatting
    return valueStr.replace(/\d/g, '*'); // Replace all digits with asterisks while keeping formatting
  };

  return (
    <div className="swap-container p-4">
      {!isOnline && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 p-4 mb-4">
          <p className="text-yellow-700">
            You are currently offline. Some features may be limited.
          </p>
        </div>
      )}

      <div className="mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={toggleSelectAll}
              className="mr-2"
            />
            <span>Select All Tokens</span>
          </div>
          <div className="text-right flex items-center space-x-2">
            <div>
              <p className="text-sm text-gray-600">Total Portfolio Value</p>
              <p className="text-lg font-bold text-gray-900">
                {showValue 
                  ? formatUSD(calculateTotalValue(tokens))
                  : maskValue(calculateTotalValue(tokens))
                }
              </p>
            </div>
            <button
              onClick={() => setShowValue(!showValue)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              title={showValue ? "Hide value" : "Show value"}
            >
              {showValue ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                  <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z" />
                </svg>
              )}
            </button>
          </div>
        </div>
        
        {/* Token grid container */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {tokens
            .filter(token => !token.loading) // Only show processed tokens
            .map((token, index) => {
              const mintAddress = token.mint;
              const accountAddress = token.account;
              const tokenKey = `token-${mintAddress}-${accountAddress}-${index}`;
              const tokenValue = token.price 
                ? Number(token.balance) * token.price / Math.pow(10, token.decimals || 9)
                : 0;
              
              return (
                <div key={tokenKey} 
                  className={`token-card bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow
                    ${token.error ? 'border-red-300 bg-red-50' : ''}`}
                >
                  {/* Card Header with Checkbox and Icon */}
                  <div className="flex items-start justify-between mb-3">
                    <input
                      type="checkbox"
                      checked={token.selected}
                      onChange={() => toggleToken(token.mint)}
                      className="mt-1"
                    />
                    {token.logoURI ? (
                      <div className="w-12 h-12 relative">
                        <Image
                          src={token.logoURI}
                          alt={token.symbol || 'token'}
                          width={48}
                          height={48}
                          className="rounded-full"
                          onError={(e: any) => {
                            e.target.src = '/fallback-token-icon.png'
                          }}
                        />
                      </div>
                    ) : (
                      <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                        <span className="text-lg text-gray-500">
                          {(token.symbol || '??').slice(0, 2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Token Info */}
                  <div className="space-y-2">
                    <div className="token-name-section">
                      <h3 className="font-medium text-lg truncate">
                        {token.symbol || token.mint.slice(0, 4)}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
                        {token.name || 'Unknown Token'}
                      </p>
                      {token.error && (
                        <p className="text-xs text-red-600 mt-1">
                          {token.errorMessage}
                        </p>
                      )}
                    </div>

                    {/* Balance, Price and Value */}
                    <div className="token-balance-section space-y-1">
                      <p className="text-sm font-medium">
                        Balance: {formatBalance(token.balance, token.decimals)}
                      </p>
                      {token.price && token.price > 0 && (
                        <>
                          <p className="text-sm text-gray-600">
                            Price: {formatUSD(token.price)}
                          </p>
                          <p className="text-sm font-semibold text-green-600">
                            Value: {showValue 
                              ? formatUSD(tokenValue)
                              : maskValue(tokenValue)
                            }
                          </p>
                        </>
                      )}
                    </div>

                    {/* Swap Button */}
                    <button
                      onClick={() => swapToken(token)}
                      disabled={loading || token.error}
                      className={`w-full mt-2 px-3 py-2 rounded-lg transition-colors
                        ${token.error 
                          ? 'bg-red-500 hover:bg-red-700' 
                          : 'bg-blue-500 hover:bg-blue-700'} 
                        text-white disabled:opacity-50`}
                    >
                      {token.error ? 'Failed to Load' : 'Swap'}
                    </button>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <button 
        onClick={handleAutoSwap} 
        disabled={loading || tokens.filter(t => t.selected).length === 0}
        className="w-full bg-blue-500 text-white p-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Processing...' : 'Swap Selected Tokens'}
      </button>
      
      {status && (
        <div className={`status mt-4 text-sm ${
          status.includes('Too many requests') 
            ? 'text-orange-600 font-medium'
            : 'text-gray-600'
        }`}>
          {status}
        </div>
      )}
    </div>
  );
} 