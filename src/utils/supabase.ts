import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});

interface TokenOperations {
  wallet_address: string;
  close_count: number;
  swap_count: number;
  sol_balance: number;
  last_operation_time: string;
  last_balance_update: string;
}

// Local storage key
const OPERATIONS_CACHE_KEY = 'token_operations_cache';
const LAST_SYNC_KEY = 'last_sync_time';

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
  const timestamp = new Date().toISOString();
  const existing = operations.find(op => op.wallet_address === walletAddress);

  if (existing) {
    if (type === 'close') existing.close_count += count;
    else existing.swap_count += count;
    existing.last_operation_time = timestamp;
    existing.last_balance_update = timestamp;
  } else {
    // Create a new entry with appropriate counters
    operations.push({
      wallet_address: walletAddress,
      close_count: type === 'close' ? count : 0,
      swap_count: type === 'swap' ? count : 0,
      sol_balance: 0,
      last_operation_time: timestamp,
      last_balance_update: timestamp
    });
  }

  localStorage.setItem(OPERATIONS_CACHE_KEY, JSON.stringify(operations));
  
  // Try to sync immediately, but don't block the UI
  syncOperationsToSupabase().catch(err => 
    console.error('Failed to sync operations immediately:', err)
  );
};

// Check if 5 minutes have passed since last sync
const shouldSync = (): boolean => {
  const lastSync = localStorage.getItem(LAST_SYNC_KEY);
  if (!lastSync) return true;

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return new Date(lastSync) < fiveMinutesAgo;
};

// Sync cached operations to Supabase
export const syncOperationsToSupabase = async () => {
  if (!shouldSync()) return;
  
  const operations = getCachedOperations();
  if (operations.length === 0) return;

  try {
    for (const operation of operations) {
      // First get existing counts
      const { data: existing } = await supabase
        .from('token_operations')
        .select('swap_count, close_count')
        .eq('wallet_address', operation.wallet_address)
        .single();

      // Add new counts to existing counts (or start from 0 if no existing record)
      const newCounts = {
        swap_count: (existing?.swap_count || 0) + operation.swap_count,
        close_count: (existing?.close_count || 0) + operation.close_count,
      };

      // Update with combined counts
      const { error } = await supabase
        .from('token_operations')
        .upsert({
          wallet_address: operation.wallet_address,
          swap_count: newCounts.swap_count,
          close_count: newCounts.close_count,
          sol_balance: operation.sol_balance,
          last_operation_time: operation.last_operation_time,
          last_balance_update: operation.last_balance_update
        }, {
          onConflict: 'wallet_address'
        });

      if (error) throw error;
    }

    // Update last sync time and clear cache after successful sync
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
    localStorage.setItem(OPERATIONS_CACHE_KEY, '[]');
    
    console.log('Successfully synced operations at:', new Date().toISOString());
  } catch (error) {
    console.error('Failed to sync operations:', error);
  }
};

// Set up interval to sync operations to Supabase
export const setupOperationSync = (): NodeJS.Timeout => {
  // Initial sync on setup
  syncOperationsToSupabase().catch(err => 
    console.error('Failed initial sync:', err)
  );
  
  // Set up interval (every 5 minutes)
  return setInterval(() => {
    syncOperationsToSupabase().catch(err => 
      console.error('Failed periodic sync:', err)
    );
  }, 5 * 60 * 1000); // 5 minutes
};

// Added function to update SOL balance
export const updateWalletBalance = async (walletAddress: string, solBalance: number) => {
  const { error } = await supabase
    .from('token_operations')
    .upsert({
      wallet_address: walletAddress,
      sol_balance: solBalance,
      last_balance_update: new Date().toISOString()
    }, {
      onConflict: 'wallet_address'
    });

  if (error) console.error('Error updating SOL balance:', error);
}; 