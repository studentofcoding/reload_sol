import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Add API key to client options
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false // Since we're only doing anonymous operations
  },
  global: {
    headers: {
      apikey: supabaseKey
    }
  }
});

interface TokenOperations {
  wallet_address: string;
  close_count: number;
  swap_count: number;
}

// Local storage key
const OPERATIONS_CACHE_KEY = 'token_operations_cache';

// Get cached operations
export const getCachedOperations = (): TokenOperations[] => {
  try {
    const cached = localStorage.getItem(OPERATIONS_CACHE_KEY);
    return cached ? JSON.parse(cached) : [];
  } catch {
    return [];
  }
};

// Add operation to cache
export const cacheOperation = (walletAddress: string, type: 'close' | 'swap', count: number) => {
  const operations = getCachedOperations();
  const existing = operations.find(op => op.wallet_address === walletAddress);

  if (existing) {
    if (type === 'close') existing.close_count += count;
    else existing.swap_count += count;
  } else {
    operations.push({
      wallet_address: walletAddress,
      close_count: type === 'close' ? count : 0,
      swap_count: type === 'swap' ? count : 0
    });
  }

  localStorage.setItem(OPERATIONS_CACHE_KEY, JSON.stringify(operations));
};

// Sync cached operations to Supabase
export const syncOperationsToSupabase = async () => {
  const operations = getCachedOperations();
  if (operations.length === 0) return;

  try {
    for (const operation of operations) {
      const { data, error } = await supabase
        .from('token_operations')
        .upsert({
          wallet_address: operation.wallet_address,
          close_count: operation.close_count,
          swap_count: operation.swap_count,
          last_operation_time: new Date().toISOString()
        }, {
          onConflict: 'wallet_address',
          ignoreDuplicates: false
        });

      if (error) throw error;
    }

    // Clear cache after successful sync
    localStorage.setItem(OPERATIONS_CACHE_KEY, '[]');
  } catch (error) {
    console.error('Failed to sync operations:', error);
  }
}; 