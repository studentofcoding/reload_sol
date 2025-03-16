'use client';

import { FC, useState, useEffect, useContext, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection } from '@solana/web3.js';
import UserContext from '@/contexts/usercontext';
import CopyTradersList from '@/components/CopyTradersList';
import CopyTraderSettings from '@/components/CopyTraderSettings';
import { 
  fetchCopyTraders, 
  startTradeMonitoring, 
  stopTradeMonitoring,
  getCopyTradeHistory
} from '@/utils/copyTraders';
import { isCopyTradingActive } from '@/utils/transactions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import LoadingSpinner from '@/components/LoadingSpinner';
import { errorAlert, successAlert } from '@/components/Toast';

const CopyTradersPage: FC = () => {
  const wallet = useWallet();
  const { publicKey } = wallet;
  const { loadingState, updateLoadingState } = useContext<any>(UserContext);
  const [traders, setTraders] = useState<any[]>([]);
  const [followedTraders, setFollowedTraders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'all' | 'followed'>('all');
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [isMonitoringActive, setIsMonitoringActive] = useState<boolean>(false);

  // Load traders and followed traders when wallet connects
  useEffect(() => {
    if (publicKey) {
      loadTraders();
      loadFollowedTraders();
      loadTradeHistory();
      
      // Check if copy trading is active
      const isActive = isCopyTradingActive(publicKey);
      setIsMonitoringActive(isActive);
      
      // If active, start monitoring
      if (isActive) {
        startMonitoring();
      }
    }
  }, [publicKey]);

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      stopTradeMonitoring();
    };
  }, []);

  const loadTraders = async () => {
    try {
      setIsLoading(true);
      const tradersData = await fetchCopyTraders();
      setTraders(tradersData);
    } catch (error) {
      console.error('Failed to load traders:', error);
      errorAlert('Failed to load traders. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFollowedTraders = async () => {
    if (!publicKey) return;
    
    try {
      // This would be replaced with an actual API call to get followed traders
      const followed = localStorage.getItem(`followed_traders_${publicKey.toString()}`);
      if (followed) {
        setFollowedTraders(JSON.parse(followed));
      }
    } catch (error) {
      console.error('Failed to load followed traders:', error);
    }
  };

  const loadTradeHistory = async () => {
    if (!publicKey) return;
    
    try {
      const history = getCopyTradeHistory(publicKey.toString());
      setTradeHistory(history);
    } catch (error) {
      console.error('Failed to load trade history:', error);
    }
  };

  const handleFollowTrader = (traderAddress: string) => {
    if (!publicKey) return;
    
    const newFollowed = [...followedTraders, traderAddress];
    setFollowedTraders(newFollowed);
    localStorage.setItem(`followed_traders_${publicKey.toString()}`, JSON.stringify(newFollowed));
    
    // If monitoring is active, restart it with the new trader list
    if (isMonitoringActive) {
      startMonitoring(newFollowed);
    }
  };

  const handleUnfollowTrader = (traderAddress: string) => {
    if (!publicKey) return;
    
    const newFollowed = followedTraders.filter(addr => addr !== traderAddress);
    setFollowedTraders(newFollowed);
    localStorage.setItem(`followed_traders_${publicKey.toString()}`, JSON.stringify(newFollowed));
    
    // If monitoring is active, restart it with the updated trader list
    if (isMonitoringActive) {
      startMonitoring(newFollowed);
    }
  };

  const startMonitoring = useCallback((traders = followedTraders) => {
    if (!publicKey || traders.length === 0) return;
    
    try {
      // Get copy trading settings from localStorage
      const configStr = localStorage.getItem(`copy_trading_${publicKey.toString()}`);
      if (!configStr) return;
      
      const config = JSON.parse(configStr);
      if (!config.active) return;
      
      const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC!);
      
      // Start monitoring trades
      startTradeMonitoring(
        wallet,
        connection,
        traders,
        {
          maxAmountPerTrade: config.maxAmountPerTrade || 0.01,
          slippage: config.slippage || 1.0,
        }
      );
      
      setIsMonitoringActive(true);
    } catch (error) {
      console.error('Failed to start trade monitoring:', error);
      errorAlert('Failed to start trade monitoring');
    }
  }, [publicKey, followedTraders, wallet]);

  const stopMonitoring = useCallback(() => {
    stopTradeMonitoring();
    setIsMonitoringActive(false);
  }, []);

  // Handle copy trading toggle from settings
  const handleCopyTradingToggle = useCallback((isActive: boolean) => {
    setIsMonitoringActive(isActive);
    
    if (isActive) {
      startMonitoring();
    } else {
      stopMonitoring();
    }
  }, [startMonitoring, stopMonitoring]);

  const filteredTraders = activeTab === 'all' 
    ? traders 
    : traders.filter(trader => followedTraders.includes(trader.address));

  if (!publicKey) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <Card className="bg-black/80 border border-white/20">
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <h3 className="text-xl font-medium text-white/90 mb-4">
                Connect your wallet to use Copy Traders
              </h3>
              <p className="text-white/70">
                You need to connect your wallet to view and follow traders.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300 mb-2">
          Copy Traders
        </h1>
        <p className="text-white/70">
          Follow successful traders and automatically copy their trades to boost your returns.
        </p>
      </div>

      <div className="mb-6">
        <div className="flex border-b border-white/20">
          <button
            className={`px-4 py-2 font-medium ${
              activeTab === 'all' 
                ? 'text-white border-b-2 border-white' 
                : 'text-white/60 hover:text-white/80'
            }`}
            onClick={() => setActiveTab('all')}
          >
            All Traders
          </button>
          <button
            className={`px-4 py-2 font-medium ${
              activeTab === 'followed' 
                ? 'text-white border-b-2 border-white' 
                : 'text-white/60 hover:text-white/80'
            }`}
            onClick={() => setActiveTab('followed')}
          >
            Followed Traders ({followedTraders.length})
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          <CopyTradersList 
            traders={filteredTraders}
            followedTraders={followedTraders}
            onFollow={handleFollowTrader}
            onUnfollow={handleUnfollowTrader}
          />
          
          {activeTab === 'followed' && followedTraders.length > 0 && (
            <div className="mt-8">
              <CopyTraderSettings 
                followedTraders={followedTraders.map(addr => 
                  traders.find(t => t.address === addr) || { address: addr }
                )}
                isMonitoringActive={isMonitoringActive}
                onToggleMonitoring={handleCopyTradingToggle}
              />
            </div>
          )}
          
          {/* Trade History Section */}
          {tradeHistory.length > 0 && (
            <div className="mt-8">
              <Card className="bg-black/80 border border-white/20">
                <CardHeader>
                  <CardTitle className="text-xl font-bold text-white">Recent Copy Trades</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-white/80">
                      <thead className="text-xs uppercase text-white/60 border-b border-white/20">
                        <tr>
                          <th className="px-4 py-3">Time</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Amount</th>
                          <th className="px-4 py-3">Trader</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tradeHistory.slice(0, 5).map((trade, index) => (
                          <tr key={index} className="border-b border-white/10">
                            <td className="px-4 py-3">
                              {new Date(trade.timestamp).toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-1 rounded-full text-xs ${
                                trade.side === 'buy' 
                                  ? 'bg-green-500/20 text-green-400' 
                                  : 'bg-red-500/20 text-red-400'
                              }`}>
                                {trade.side.toUpperCase()}
                              </span>
                            </td>
                            <td className="px-4 py-3">{trade.amount} SOL</td>
                            <td className="px-4 py-3">
                              {trade.traderAddress.slice(0, 4)}...{trade.traderAddress.slice(-4)}
                            </td>
                            <td className="px-4 py-3">
                              <a 
                                href={`https://solscan.io/tx/${trade.signature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:underline"
                              >
                                View
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CopyTradersPage; 