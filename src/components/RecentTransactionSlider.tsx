"use client";
import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabase';

interface Transaction {
  wallet_address: string;
  sol_balance: number;
  swap_count: number;
  close_count: number;
  last_operation_time: string;
}

interface RecentTransactionSliderProps {
  userCurrency: 'USD' | 'IDR';
}

const RecentTransactionSlider = ({ userCurrency }: RecentTransactionSliderProps) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [nextIndex, setNextIndex] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const fetchRecentTransactions = async () => {
      try {
        const { data, error } = await supabase
          .from('token_operations')
          .select('wallet_address, sol_balance, swap_count, close_count, last_operation_time')
          .order('last_operation_time', { ascending: false })
          .limit(20);

        if (error) throw error;

        if (data) {
          const transactionsWithValue = data
            .map(tx => ({
              ...tx,
              value: (tx.swap_count + tx.close_count) * 0.0015
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);

          setTransactions(transactionsWithValue);
        }
      } catch (error) {
        console.error('Error fetching recent transactions:', error);
      }
    };

    fetchRecentTransactions();
    // Refresh data every 5 minutes
    const refreshInterval = setInterval(fetchRecentTransactions, 5 * 60 * 1000);
    return () => clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    if (transactions.length < 2) return;
    
    const interval = setInterval(() => {
      setIsTransitioning(true);
      
      // Update indices immediately but keep transition state for animation
      setTimeout(() => {
        setCurrentIndex(nextIndex);
        setNextIndex((nextIndex + 1) % transactions.length);
        // Don't reset isTransitioning here
      }, 1000);

      // Only reset transition state right before the next change
      setTimeout(() => {
        setIsTransitioning(false);
      }, 6900); // Reset just before the next transition
      
    }, 7000);

    return () => clearInterval(interval);
  }, [transactions, nextIndex]);

  if (transactions.length === 0) {
    return null;
  }

  const formatWalletAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  const currentTransaction = transactions[currentIndex];
  const nextTransaction = transactions[nextIndex];
  const getCurrentSolValue = (tx: Transaction) => ((tx.swap_count + tx.close_count) * 0.0015).toFixed(4);

  return (
    <div className="relative w-full max-w-[300px] mx-auto h-[32px] overflow-hidden z-10">
      {/* Current Transaction */}
      <div 
        className={`
          absolute w-full top-0 left-0
          transform transition-all duration-1000 ease-in-out
          ${isTransitioning ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'}
          px-3 py-1.5 rounded-full 
          bg-white/5 backdrop-blur-sm border border-white/10
          flex items-center justify-center
        `}
        style={{ willChange: 'transform, opacity' }}
      >
        <div className="text-xs text-white/70 flex items-center space-x-1 whitespace-nowrap">
          <span className="text-white/50 text-xs font-normal">
            {formatWalletAddress(currentTransaction.wallet_address)}
          </span>
          <span>{userCurrency === 'USD' ? 'just reloaded' : 'baru saja mendapatkan'}</span>
          <span className="text-white/100 font-bold">{getCurrentSolValue(currentTransaction)} SOL</span>
        </div>
      </div>

      {/* Next Transaction */}
      <div 
        className={`
          absolute w-full top-full left-0
          transform transition-all duration-1000 ease-in-out
          ${isTransitioning ? '-translate-y-full opacity-100' : 'translate-y-0 opacity-0'}
          px-3 py-1.5 rounded-full 
          bg-white/5 backdrop-blur-sm border border-white/10
          flex items-center justify-center
        `}
        style={{ willChange: 'transform, opacity' }}
      >
        <div className="text-xs text-white/70 flex items-center space-x-1 whitespace-nowrap">
          <span className="text-white/50 text-xs font-normal">
            {formatWalletAddress(nextTransaction.wallet_address)}
          </span>
          <span>{userCurrency === 'USD' ? 'just reloaded' : 'baru saja mendapatkan'}</span>
          <span className="text-white/100 font-bold">{getCurrentSolValue(nextTransaction)} SOL</span>
        </div>
      </div>
    </div>
  );
};

export default RecentTransactionSlider;