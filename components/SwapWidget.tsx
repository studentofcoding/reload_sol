import React from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { TOKEN_PROGRAM_ID, AccountLayout } from '@solana/spl-token';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import Image from 'next/image';

interface TokenInfo {
  mint: PublicKey;
  balance: bigint;
  account: PublicKey;
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

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.TOKEN_CACHE);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate stored data structure
        if (this.isValidCache(parsed)) {
          this.cache = parsed;
        }
      }
    } catch (error) {
      console.error('Error loading cache from storage:', error);
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEYS.TOKEN_CACHE, JSON.stringify(this.cache));
    } catch (error) {
      console.error('Error saving cache to storage:', error);
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

const rateLimiter = new RateLimiter(1); // 1 request per second
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

// Update RPC rate limiter
class RPCRateLimiter {
  private static instance: RPCRateLimiter;
  private lastCall: number = 0;
  private readonly minInterval: number = 1000;

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

export function SwapWidget() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [tokens, setTokens] = React.useState<TokenInfo[]>([]);
  const [selectAll, setSelectAll] = React.useState(true);
  const [isOnline, setIsOnline] = React.useState(true);
  const rpcLimiter = React.useRef(RPCRateLimiter.getInstance());
  const [tokenCache, setTokenCache] = React.useState<Record<string, { data: any; timestamp: number }>>({});

  // Initialize cache from localStorage
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('token_metadata_cache');
        if (stored) {
          setTokenCache(JSON.parse(stored));
        }

        const storedSelected = localStorage.getItem('selected_tokens');
        if (storedSelected) {
          const selectedMints = new Set(JSON.parse(storedSelected));
          setTokens(current => 
            current.map(token => ({
              ...token,
              selected: selectedMints.has(token.mint.toBase58())
            }))
          );
        }
      }
    } catch (error) {
      console.error('Error initializing from storage:', error);
    }
  }, []);

  // Save cache to localStorage when it changes
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && Object.keys(tokenCache).length > 0) {
        localStorage.setItem('token_metadata_cache', JSON.stringify(tokenCache));
      }
    } catch (error) {
      console.error('Error saving to storage:', error);
    }
  }, [tokenCache]);

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
      // Check cache first
      const cached = tokenCache[mintAddress];
      const now = Date.now();
      if (cached && now - cached.timestamp < 5 * 60 * 1000) { // 5 minutes cache
        return cached.data;
      }

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
        throw new Error('Failed to fetch token metadata');
      }

      const data: TokenResponse = await response.json();
      
      const activePool = data.pools.find(pool => 
        pool.price?.usd !== null && pool.price?.usd > 0
      );

      const tokenData = {
        address: mintAddress,
        chainId: 101,
        decimals: data.token.decimals,
        name: data.token.name,
        symbol: data.token.symbol,
        logoURI: data.token.image,
        price: activePool?.price?.usd || 0,
        extensions: {
          website: data.token.website,
          twitter: data.token.twitter
        }
      };

      // Update cache
      setTokenCache(prev => ({
        ...prev,
        [mintAddress]: {
          data: tokenData,
          timestamp: now
        }
      }));

      return tokenData;
    } catch (error) {
      console.error('Error fetching token data:', error);
      return null;
    }
  };

  // Update saveSelectedTokens to check for window
  const saveSelectedTokens = React.useCallback((tokens: TokenInfo[]) => {
    try {
      if (typeof window !== 'undefined') {
        const selectedMints = tokens
          .filter(t => t.selected)
          .map(t => t.mint.toBase58());
        localStorage.setItem('selected_tokens', JSON.stringify(selectedMints));
      }
    } catch (error) {
      console.error('Error saving selected tokens:', error);
    }
  }, []);

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
      const tokenAccounts = await rpcLimiter.current.call(() => 
        connection.getTokenAccountsByOwner(publicKey, {
          programId: TOKEN_PROGRAM_ID,
        })
      );

      // Clear existing tokens before fetching new ones
      setTokens([]);
      const tokenInfos: TokenInfo[] = [];
      let processedCount = 0;
      const totalCount = tokenAccounts.value.length;

      // Process tokens one by one
      for (const account of tokenAccounts.value) {
        try {
          const accountData = AccountLayout.decode(account.account.data);
          const mintAddress = new PublicKey(accountData.mint);
          const mintKey = mintAddress.toBase58();
          
          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const tokenMeta = await fetchTokenMetadata(mintKey);
          if (tokenMeta && accountData.amount > 0n) {
            const price = tokenMeta.price || 0;
            const value = calculateValue(accountData.amount, tokenMeta.decimals || 9, price);
            
            processedCount++;
            setStatus(`Loading tokens... ${processedCount}/${totalCount}`);

            const tokenInfo: TokenInfo = {
              mint: mintAddress,
              balance: accountData.amount,
              account: account.pubkey,
              selected: true,
              symbol: tokenMeta.symbol,
              name: tokenMeta.name,
              logoURI: tokenMeta.logoURI,
              decimals: tokenMeta.decimals,
              price,
              value,
            };

            tokenInfos.push(tokenInfo);
            
            // Update tokens state after each successful fetch
            setTokens(current => {
              const newTokens = [...current, tokenInfo];
              return newTokens.sort((a, b) => (b.value || 0) - (a.value || 0));
            });
          }
        } catch (error) {
          console.error(`Error processing token ${account.pubkey.toBase58()}:`, error);
          // Continue with next token if one fails
          processedCount++;
          setStatus(`Loading tokens... ${processedCount}/${totalCount} (Skipped one token due to error)`);
        }
      }

      // Final status update
      setStatus(tokenInfos.length > 0 ? '' : 'No tokens found');
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
  const toggleToken = (mint: string) => {
    setTokens(prev => {
      const updated = prev.map(token => 
        token.mint.toBase58() === mint 
          ? { ...token, selected: !token.selected }
          : token
      );
      saveSelectedTokens(updated);
      return updated;
    });
  };

  // Update toggleSelectAll to save selection
  const toggleSelectAll = () => {
    setSelectAll(!selectAll);
    setTokens(prev => {
      const updated = prev.map(token => ({ ...token, selected: !selectAll }));
      saveSelectedTokens(updated);
      return updated;
    });
  };

  const swapToken = async (tokenInfo: TokenInfo) => {
    if (!publicKey) return;
    
    setLoading(true);
    try {
      setStatus(`Swapping ${tokenInfo.mint.toBase58()}...`);
      
      const quoteResponse = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${tokenInfo.mint.toBase58()}` +
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
      swapTx.sign([await signTransaction(swapTx)]);
      const txid = await connection.sendRawTransaction(swapTx.serialize());
      await connection.confirmTransaction(txid);

      setStatus(`Successfully swapped ${tokenInfo.mint.toBase58()}`);
      await fetchTokenAccounts();
    } catch (error) {
      console.error(`Failed to swap token:`, error);
      setStatus(`Failed to swap: ${error.message}`);
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
        
        {tokens.map(token => {
          const tokenKey = `token-${token.mint.toBase58()}-${token.account.toBase58()}`;
          return (
            <div key={tokenKey} className="token-item flex items-center justify-between p-2 border rounded mb-2 hover:bg-gray-50">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={token.selected}
                  onChange={() => toggleToken(token.mint.toBase58())}
                  className="mr-2"
                />
                {token.logoURI ? (
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
                    {token.symbol || token.mint.toBase58().slice(0, 4)}
                  </span>
                  <span className="text-sm text-gray-500">
                    {token.name || 'Unknown Token'}
                  </span>
                </div>
                <div className="flex flex-col ml-4">
                  <span className="text-sm">
                    Balance: {formatBalance(token.balance, token.decimals)}
                  </span>
                  {token.price > 0 && (
                    <span className="text-xs text-gray-500">
                      ${formatBalance(BigInt(Math.floor(token.price * 1e9)), 9)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => swapToken(token)}
                disabled={loading}
                className="ml-2 px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Swap
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