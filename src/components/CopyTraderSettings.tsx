'use client';

import { FC, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FaCoins, FaPercentage, FaToggleOn, FaToggleOff } from 'react-icons/fa';
import { startCopyTrading, stopCopyTrading, isCopyTradingActive } from '@/utils/transactions';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection } from '@solana/web3.js';
import { errorAlert, successAlert } from '@/components/Toast';
import LoadingSpinner from '@/components/LoadingSpinner';

interface CopyTraderSettingsProps {
  followedTraders: any[];
  isMonitoringActive?: boolean;
  onToggleMonitoring?: (isActive: boolean) => void;
}

const CopyTraderSettings: FC<CopyTraderSettingsProps> = ({ 
  followedTraders,
  isMonitoringActive = false,
  onToggleMonitoring
}) => {
  const wallet = useWallet();
  const { publicKey, signTransaction } = wallet;
  const [isActive, setIsActive] = useState(isMonitoringActive);
  const [maxAmount, setMaxAmount] = useState(0.01);
  const [slippage, setSlippage] = useState(1.0);
  const [isLoading, setIsLoading] = useState(false);

  // Load settings from localStorage when component mounts
  useEffect(() => {
    if (publicKey) {
      loadSettings();
    }
  }, [publicKey]);

  // Update local state when isMonitoringActive prop changes
  useEffect(() => {
    setIsActive(isMonitoringActive);
  }, [isMonitoringActive]);

  const loadSettings = () => {
    if (!publicKey) return;
    
    try {
      const configStr = localStorage.getItem(`copy_trading_${publicKey.toString()}`);
      if (configStr) {
        const config = JSON.parse(configStr);
        setMaxAmount(config.maxAmountPerTrade || 0.01);
        setSlippage(config.slippage || 1.0);
        setIsActive(config.active || false);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleToggleCopyTrading = async () => {
    if (!publicKey || !signTransaction) {
      errorAlert('Please connect your wallet first');
      return;
    }

    try {
      setIsLoading(true);
      
      if (isActive) {
        await stopCopyTrading(publicKey);
        successAlert('Copy trading stopped successfully');
        setIsActive(false);
        
        // Notify parent component
        if (onToggleMonitoring) {
          onToggleMonitoring(false);
        }
      } else {
        const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC!);
        
        const traderAddresses = followedTraders.map(trader => trader.address);
        await startCopyTrading(
          traderAddresses,
          wallet,
          connection,
          {
            maxAmountPerTrade: maxAmount,
            slippage: slippage,
          }
        );
        
        successAlert('Copy trading started successfully');
        setIsActive(true);
        
        // Notify parent component
        if (onToggleMonitoring) {
          onToggleMonitoring(true);
        }
      }
    } catch (error) {
      console.error('Error toggling copy trading:', error);
      errorAlert('Failed to toggle copy trading. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="bg-black/80 border border-white/20">
      <CardHeader>
        <CardTitle className="text-xl font-bold text-white">Copy Trading Settings</CardTitle>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-6">
          <div>
            <label className="flex items-center justify-between mb-2">
              <span className="text-white/80">Max Amount per Trade (SOL)</span>
              <div className="flex items-center">
                <FaCoins className="text-white/60 mr-2" />
                <input
                  type="number"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(parseFloat(e.target.value))}
                  min={0.001}
                  max={10}
                  step={0.001}
                  disabled={isActive || isLoading}
                  className="w-24 px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-right"
                />
              </div>
            </label>
            <input
              type="range"
              min={0.001}
              max={1}
              step={0.001}
              value={maxAmount}
              onChange={(e) => setMaxAmount(parseFloat(e.target.value))}
              disabled={isActive || isLoading}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          
          <div>
            <label className="flex items-center justify-between mb-2">
              <span className="text-white/80">Slippage Tolerance (%)</span>
              <div className="flex items-center">
                <FaPercentage className="text-white/60 mr-2" />
                <input
                  type="number"
                  value={slippage}
                  onChange={(e) => setSlippage(parseFloat(e.target.value))}
                  min={0.1}
                  max={5}
                  step={0.1}
                  disabled={isActive || isLoading}
                  className="w-24 px-2 py-1 bg-white/10 border border-white/20 rounded text-white text-right"
                />
              </div>
            </label>
            <input
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={slippage}
              onChange={(e) => setSlippage(parseFloat(e.target.value))}
              disabled={isActive || isLoading}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
          </div>
          
          <div className="pt-4">
            <button
              onClick={handleToggleCopyTrading}
              disabled={isLoading || followedTraders.length === 0}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg transition-colors ${
                followedTraders.length === 0
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : isActive
                    ? 'bg-red-500/80 hover:bg-red-600/80 text-white'
                    : 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white'
              }`}
            >
              {isLoading ? (
                <LoadingSpinner size="sm" />
              ) : isActive ? (
                <FaToggleOn size={20} />
              ) : (
                <FaToggleOff size={20} />
              )}
              <span>
                {isLoading 
                  ? 'Processing...' 
                  : followedTraders.length === 0
                    ? 'Follow traders to enable copy trading'
                    : isActive 
                      ? 'Stop Copy Trading' 
                      : 'Start Copy Trading'
                }
              </span>
            </button>
          </div>
          
          {isActive && (
            <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <p className="text-green-400 text-sm">
                <span className="font-semibold">Copy trading is active!</span> The system will automatically copy trades from your followed traders.
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default CopyTraderSettings; 