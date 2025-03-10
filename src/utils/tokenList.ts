import { errorAlert } from "@/components/Toast";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getMetadataAccountDataSerializer } from '@metaplex-foundation/mpl-token-metadata';
import { getPdaMetadataKey } from "@raydium-io/raydium-sdk";
import { TokenInfo, TokenCache, TokenData, JupiterPriceResponse } from "@/types/token";
import { startTimer, stopTimer, measureAsync } from "./timing";


// Add excluded and problematic token lists
const EXCLUDED_MINTS = [
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
];

const PROBLEMATIC_MINTS = [
  '1Qf8gESP4i6CFNWerUSDdLKJ9U1LpqTYvjJ2MM4pain', // PAIN
];

// Combine all excluded mints
const ALL_EXCLUDED_MINTS = [...EXCLUDED_MINTS, ...PROBLEMATIC_MINTS];

const BATCH_SIZE = 100;
const PARALLEL_BATCHES = 2;
const RPC_DELAY = 200;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour
const MAX_ACCOUNTS_PER_REQUEST = 100; // Solana's limit

const tokenCache = new Map<string, TokenCache>();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function batchFetchPrices(mints: string[]): Promise<Record<string, number>> {
  startTimer('jupiter-batch');
  const chunks = [];
  for (let i = 0; i < mints.length; i += BATCH_SIZE) {
    chunks.push(mints.slice(i, i + BATCH_SIZE));
  }

  const prices: Record<string, number> = {};
  const RETRY_DELAY = 400;
  const MAX_RETRIES = 3;

  await Promise.all(chunks.map(async (chunk, index) => {
    const chunkLabel = `Price Chunk ${index + 1}/${chunks.length}`;
    startTimer(chunkLabel);
    
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        const mintIds = chunk.join(',');
        const response = await fetch(`https://api.jup.ag/price/v2?ids=${mintIds}`);
        const priceData = (await response.json()) as JupiterPriceResponse;
        console.log(`Price data for chunk ${index + 1}:`, priceData);
        
        if (priceData?.data) {
          Object.entries(priceData.data).forEach(([mint, data]) => {
            // Only set price if data exists and is not null
            if (data && data.price) {
              prices[mint] = parseFloat(data.price);
            } else {
              prices[mint] = 0; // Default price for null values
            }
          });
          break; // Success, exit retry loop
        }
        
        await sleep(RETRY_DELAY);
      } catch (error) {
        console.warn(`Price fetch attempt ${retry + 1} failed:`, error);
        if (retry === MAX_RETRIES - 1) {
          console.error('Price fetch failed after all retries');
        } else {
          await sleep(RETRY_DELAY);
        }
      }
    }
    
    stopTimer(chunkLabel);
  }));
  
  stopTimer('jupiter-batch');
  console.log(`Fetched prices for ${Object.keys(prices).length}/${mints.length} tokens`);
  return prices;
}

async function batchFetchTokenData(connection: Connection, mints: PublicKey[]): Promise<TokenData[]> {
  console.time('rpc-batch');
  
  let allResults: TokenData[] = [];
  // Process in chunks of 50 mints (100 accounts when including metadata)
  for (let i = 0; i < mints.length; i += 50) {
    const mintChunk = mints.slice(i, i + 50);
    const accountsToFetch = mintChunk.flatMap(mint => [
      mint,
      getPdaMetadataKey(mint).publicKey
    ]);

    try {
      const accountInfos = await connection.getMultipleAccountsInfo(accountsToFetch);
      
      const chunkResults = mintChunk.map((mint, j) => {
        const mintInfo = accountInfos[j * 2];
        const metadataAccount = accountInfos[j * 2 + 1];

        if (mintInfo?.data[44] == 0) {
          return null;
        }

        if (!mintInfo || !metadataAccount?.data) return null;

        try {
          const serializer = getMetadataAccountDataSerializer();
          const metadata = serializer.deserialize(metadataAccount.data as any)[0];
          
          return {
            mint: mint.toBase58(),
            metadata,
            decimals: mintInfo.data[44]
          };
        } catch (error) {
          console.warn(`Data parse failed for ${mint.toBase58()}:`, error);
          return null;
        }
      });

      allResults = [...allResults, ...chunkResults.filter((result): result is TokenData => result !== null)];
    } catch (error) {
      console.error(`Failed to fetch chunk ${i}-${i + 50}:`, error);
    }

    // Add delay between chunks to respect rate limits
    await sleep(RPC_DELAY);
  }
  
  console.timeEnd('rpc-batch');
  return allResults;
}

async function processBatch(
  connection: Connection,
  tokenAccounts: any[],
  prices: Record<string, number>
): Promise<TokenInfo[]> {
  console.log('Processing batch of', tokenAccounts.length, 'token accounts');
  
  // Filter out excluded tokens before processing
  const filteredAccounts = tokenAccounts.filter(acc => 
    !ALL_EXCLUDED_MINTS.includes(acc.account.data.parsed.info.mint)
  );
  
  const mintPublicKeys = filteredAccounts.map(acc => 
    new PublicKey(acc.account.data.parsed.info.mint)
  );

  const tokenData = await batchFetchTokenData(connection, mintPublicKeys);
  console.log('Retrieved token data for', tokenData.length, 'tokens');
  
  const processedTokens = filteredAccounts.map((account): TokenInfo | null => {
    const mint = account.account.data.parsed.info.mint;
    const tokenAmount = account.account.data.parsed.info.tokenAmount.uiAmount;
    
    const cached = tokenCache.get(mint);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      console.log(`Using cached data for token ${mint}`);
      return {
        ...cached.data,
        balance: tokenAmount
      };
    }

    const data = tokenData?.find(d => d.mint === mint);
    if (!data) {
      // console.log(`No data found for token ${mint}`);
      return null;
    }

    const tokenInfo: TokenInfo = {
      id: mint,
      balance: tokenAmount,
      name: data.metadata.name || 'Unknown',
      symbol: data.metadata.symbol || 'Unknown',
      price: prices[mint] || 0,
      decimal: data.decimals
    };

    // console.log(`Caching data for token ${mint}`);
    tokenCache.set(mint, {
      data: tokenInfo,
      timestamp: Date.now()
    });

    return tokenInfo;
  }).filter((token): token is TokenInfo => token !== null);

  // console.log('Batch processing complete with', processedTokens.length, 'valid tokens');
  return processedTokens;
}

// Add a loading state to prevent duplicate fetches
let isLoading = false;

// Add this type to handle multiple token lists
type TokenLists = {
  zeroTokens: TokenInfo[];
  nonZeroTokens: TokenInfo[];
};

// Create a new unified function
export async function getFilteredTokenLists(
  address: string,
  setLoadingState: (loading: boolean) => void,
  progressCallback?: (progress: number) => void
): Promise<TokenLists> {
  if (isLoading) {
    // console.log('Token fetch already in progress, skipping...');
    return { zeroTokens: [], nonZeroTokens: [] };
  }
  
  isLoading = true;
  try {
    const connection = new Connection(String(process.env.NEXT_PUBLIC_SOLANA_RPC));
    
    // Single RPC call to get all token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(address),
      { programId: TOKEN_PROGRAM_ID }
    );

    // Split accounts by balance
    const zeroAccounts = tokenAccounts.value.filter(acc => 
      acc.account.data.parsed.info.tokenAmount.uiAmount === 0
    );
    const nonZeroAccounts = tokenAccounts.value.filter(acc => 
      acc.account.data.parsed.info.tokenAmount.uiAmount > 0
    );

    // Get all unique mints at once
    const allMints = Array.from(new Set([
      ...zeroAccounts.map(acc => acc.account.data.parsed.info.mint),
      ...nonZeroAccounts.map(acc => acc.account.data.parsed.info.mint)
    ]));

    // Single price fetch for all tokens
    const prices = await batchFetchPrices(allMints);

    // Process both lists in parallel
    const [zeroTokens, nonZeroTokens] = await Promise.all([
      processTokenBatches(connection, zeroAccounts, prices, progressCallback),
      processTokenBatches(connection, nonZeroAccounts, prices, progressCallback)
    ]);

    // Filter non-zero tokens worth more than $0.5
    const filteredNonZeroTokens = nonZeroTokens.filter(token => {
      const tokenValue = token.price * token.balance;
      return tokenValue < 0.5;
    });

    return {
      zeroTokens,
      nonZeroTokens: filteredNonZeroTokens
    };

  } catch (err) {
    console.error("ERROR in getFilteredTokenLists:", err);
    errorAlert(err);
    return { zeroTokens: [], nonZeroTokens: [] };
  } finally {
    isLoading = false;
    setLoadingState(false);
  }
}

// Helper function to process tokens in batches
async function processTokenBatches(
  connection: Connection,
  accounts: any[],
  prices: Record<string, number>,
  progressCallback?: (progress: number) => void
): Promise<TokenInfo[]> {
  const chunks = [];
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    chunks.push(accounts.slice(i, i + BATCH_SIZE));
  }

  let processedTokens: TokenInfo[] = [];
  for (let i = 0; i < chunks.length; i += PARALLEL_BATCHES) {
    const batchChunks = chunks.slice(i, i + PARALLEL_BATCHES);
    const batchResults = await Promise.all(
      batchChunks.map(chunk => processBatch(connection, chunk, prices))
    );
    
    processedTokens = [...processedTokens, ...batchResults.flat()];
    
    const progress = Math.min(
      ((i + PARALLEL_BATCHES) / chunks.length) * 100,
      100
    );
    progressCallback?.(progress);

    if (i + PARALLEL_BATCHES < chunks.length) {
      await sleep(RPC_DELAY);
    }
  }

  return processedTokens;
}

export function forceRefreshTokens(): void {
  // console.log('Clearing token cache');
  tokenCache.clear();
}