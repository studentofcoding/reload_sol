import { PublicKey, Connection } from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { executeCopyTrade, isCopyTradingActive } from './transactions';
import { errorAlert, successAlert } from '@/components/Toast';

// Mock data for development - would be replaced with actual API calls
const MOCK_TRADERS = [
  {
    address: '3V3N5xh6vUUVU3CnbjMAXoyXendfXzXYKzTVEsFrLkgX',
    name: 'Alpha Trader',
    category: 'DeFi',
    totalTrades: 156,
    successRate: 78,
    pnlPercentage: 124.5,
    description: 'Specializes in DeFi protocols and new token launches with consistent returns.'
  },
  {
    address: 'suqh5sHtr8HyJ7q8scBimULPkPpA557prMG47xCHQfK',
    name: 'Whale Watcher',
    category: 'Memecoins',
    totalTrades: 89,
    successRate: 65,
    pnlPercentage: 210.3,
    description: 'Follows whale movements and capitalizes on memecoin momentum.'
  },
  {
    address: 'FrKWJKLDvTn4ghZSkMXTSERPA7KowWLds2vsMw7QpvNk',
    name: 'Trend Surfer',
    category: 'NFTs',
    totalTrades: 203,
    successRate: 72,
    pnlPercentage: 95.8,
    description: 'Focuses on trending NFT projects and related tokens.'
  },
  {
    address: 'AArPXm8JatJiuyEffuC1un2Sc835SULa4uQqDcaGpAjV',
    name: 'Solana Maximalist',
    category: 'Ecosystem',
    totalTrades: 178,
    successRate: 81,
    pnlPercentage: 143.2,
    description: 'Trades only Solana ecosystem tokens with a focus on infrastructure projects.'
  }
];

// WebSocket connection for trade monitoring
let tradeWebSocket: WebSocket | null = null;
let tradeMonitorInterval: NodeJS.Timeout | null = null;

export async function fetchCopyTraders() {
  // In a real implementation, this would fetch data from an API
  // For now, we'll return mock data
  return new Promise<any[]>((resolve) => {
    setTimeout(() => {
      resolve(MOCK_TRADERS);
    }, 1000);
  });
}

export async function getTraderPerformance(traderAddress: string) {
  // Mock implementation - would be replaced with actual API call
  const trader = MOCK_TRADERS.find(t => t.address === traderAddress);
  
  if (!trader) {
    throw new Error('Trader not found');
  }
  
  return {
    address: trader.address,
    totalTrades: trader.totalTrades,
    successRate: trader.successRate,
    pnlPercentage: trader.pnlPercentage,
    recentTrades: [
      // Mock recent trades
      {
        timestamp: Date.now() - 3600000,
        tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        tokenSymbol: 'BONK',
        side: 'buy',
        amount: 0.05,
        price: 0.00000012,
      },
      {
        timestamp: Date.now() - 7200000,
        tokenAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
        tokenSymbol: 'WIF',
        side: 'sell',
        amount: 0.08,
        price: 0.00000345,
      }
    ]
  };
}

/**
 * Start monitoring trades for the specified traders
 */
export function startTradeMonitoring(
  wallet: WalletContextState,
  connection: Connection,
  followedTraders: string[],
  options: {
    maxAmountPerTrade: number;
    slippage: number;
  }
) {
  // Close any existing connections
  stopTradeMonitoring();

  // Create a new WebSocket connection
  tradeWebSocket = new WebSocket('wss://pumpportal.fun/api/data');

  tradeWebSocket.onopen = () => {
    console.log('WebSocket connected for trade monitoring');
    
    // Subscribe to trades from followed traders
    const payload = {
      method: "subscribeAccountTrade",
      keys: followedTraders // array of accounts to watch
    };
    
    if (tradeWebSocket) {
      tradeWebSocket.send(JSON.stringify(payload));
    }
    
    // Log successful connection
    successAlert('Trade monitoring started');
  };

  tradeWebSocket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received trade data:', data);
      
      // Check if this is a trade event
      if (data.txType && data.signature) {
        // Verify this is from a followed trader
        if (followedTraders.includes(data.traderPublicKey)) {
          console.log('Detected trade from followed trader:', data);
          
          // Check if copy trading is active
          if (wallet.publicKey && isCopyTradingActive(wallet.publicKey)) {
            // Execute the copy trade
            const isBuy = data.txType === 'buy';
            const tokenMint = data.mint;
            
            // Calculate amount based on settings (capped by maxAmountPerTrade)
            const amount = Math.min(
              data.solAmount || 0.01,
              options.maxAmountPerTrade
            );
            
            // Execute the trade
            const signature = await executeCopyTrade(
              tokenMint,
              isBuy,
              amount,
              wallet,
              connection,
              {
                slippage: options.slippage,
                priorityFee: 0.000005,
              }
            );
            
            if (signature) {
              successAlert(`Successfully copied ${isBuy ? 'buy' : 'sell'} trade for ${amount} SOL`);
              
              // Store trade history in localStorage
              storeCopyTradeHistory(wallet.publicKey.toString(), {
                timestamp: Date.now(),
                tokenMint,
                traderAddress: data.traderPublicKey,
                side: isBuy ? 'buy' : 'sell',
                amount,
                signature
              });
            } else {
              errorAlert(`Failed to copy ${isBuy ? 'buy' : 'sell'} trade`);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error processing trade message:', error);
    }
  };

  tradeWebSocket.onerror = (error) => {
    console.error('WebSocket error:', error);
    errorAlert('Trade monitoring connection error');
  };

  tradeWebSocket.onclose = () => {
    console.log('WebSocket connection closed');
  };

  // Set up a heartbeat to keep the connection alive
  tradeMonitorInterval = setInterval(() => {
    if (tradeWebSocket && tradeWebSocket.readyState === WebSocket.OPEN) {
      tradeWebSocket.send(JSON.stringify({ method: "ping" }));
    } else {
      // Try to reconnect if disconnected
      stopTradeMonitoring();
      startTradeMonitoring(wallet, connection, followedTraders, options);
    }
  }, 30000); // Every 30 seconds
}

/**
 * Stop monitoring trades
 */
export function stopTradeMonitoring() {
  if (tradeWebSocket) {
    tradeWebSocket.close();
    tradeWebSocket = null;
  }

  if (tradeMonitorInterval) {
    clearInterval(tradeMonitorInterval);
    tradeMonitorInterval = null;
  }
}

/**
 * Store copy trade history in localStorage
 */
function storeCopyTradeHistory(walletAddress: string, tradeInfo: any) {
  try {
    const historyKey = `copy_trade_history_${walletAddress}`;
    const existingHistory = localStorage.getItem(historyKey);
    
    let history = [];
    if (existingHistory) {
      history = JSON.parse(existingHistory);
    }
    
    // Add new trade to history (limit to last 100 trades)
    history.unshift(tradeInfo);
    if (history.length > 100) {
      history = history.slice(0, 100);
    }
    
    localStorage.setItem(historyKey, JSON.stringify(history));
  } catch (error) {
    console.error('Error storing trade history:', error);
  }
}

/**
 * Get copy trade history from localStorage
 */
export function getCopyTradeHistory(walletAddress: string) {
  try {
    const historyKey = `copy_trade_history_${walletAddress}`;
    const existingHistory = localStorage.getItem(historyKey);
    
    if (existingHistory) {
      return JSON.parse(existingHistory);
    }
    
    return [];
  } catch (error) {
    console.error('Error retrieving trade history:', error);
    return [];
  }
} 