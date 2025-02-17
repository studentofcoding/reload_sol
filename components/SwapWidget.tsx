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
            await new Promise(resolve => setTimeout(resolve, 500)); // 500ms between requests
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
        } catch (error) {
          console.error(`Error fetching metadata for ${token.mint}:`, error);
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

  return (
    <div className="swap-container p-4">
      {!isOnline && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 p-4 mb-4">
          <p className="text-yellow-700">
            You are currently offline. Some features may be limited.
          </p>
        </div>
      )}
      <div className="token-list mb-4">
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
        </div>
        
        {tokens.map((token, index) => {
          const mintAddress = token.mint;
          const accountAddress = token.account;
          const tokenKey = `token-${mintAddress}-${accountAddress}-${index}`;
          
          return (
            <div key={tokenKey} className="token-item flex items-center justify-between p-2 border rounded mb-2 hover:bg-gray-50">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={token.selected}
                  onChange={() => toggleToken(token.mint)}
                  className="mr-2"
                />
                {token.loading ? (
                  <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse" />
                ) : token.logoURI ? (
                  <div className="w-8 h-8 relative">
                    <Image
                      src={token.logoURI}
                      alt={token.symbol || 'token'}
                      width={32}
                      height={32}
                      className="rounded-full"
                      onError={(e: any) => {
                        e.target.src = '/fallback-token-icon.png'
                      }}
                    />
                  </div>
                ) : (
                  <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                    <span className="text-xs text-gray-500">
                      {(token.symbol || '??').slice(0, 2)}
                    </span>
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="font-medium">
                    {token.loading ? (
                      <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                    ) : (
                      token.symbol || token.mint.slice(0, 4)
                    )}
                  </span>
                  <span className="text-sm text-gray-500">
                    {token.loading ? (
                      <div className="h-3 w-24 bg-gray-200 rounded animate-pulse mt-1" />
                    ) : (
                      token.name || 'Unknown Token'
                    )}
                  </span>
                </div>
                <div className="flex flex-col ml-4">
                  <span className="text-sm">
                    Balance: {formatBalance(token.balance, token.decimals)}
                  </span>
                  {!token.loading && token.price && token.price > 0 && (
                    <span className="text-xs text-gray-500">
                      ${formatBalance(BigInt(Math.floor(token.price * 1e9)), 9)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => swapToken(token)}
                disabled={loading || token.loading}
                className="ml-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {token.loading ? 'Loading...' : 'Swap'}
              </button>
            </div>
          );
        })}
      </div>

      <button 
        onClick={handleAutoSwap} 
        disabled={loading || tokens.filter(t => t.selected).length === 0}
        className="w-full bg-blue-500 text-white p-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Processing...' : 'Swap Selected Tokens'}
      </button>
      
      {status && (
        <div className="status mt-4 text-sm text-gray-600">
          {status}
        </div>
      )}
    </div>
  );
} 