'use client';

import { FC } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { FaUserCheck, FaUserPlus, FaChartLine, FaExchangeAlt } from 'react-icons/fa';

interface CopyTraderCardProps {
  trader: {
    address: string;
    name?: string;
    category?: string;
    totalTrades?: number;
    successRate?: number;
    pnlPercentage?: number;
    description?: string;
  };
  isFollowed: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
}

const CopyTraderCard: FC<CopyTraderCardProps> = ({ 
  trader, 
  isFollowed, 
  onFollow, 
  onUnfollow 
}) => {
  const {
    address,
    name = 'Anonymous Trader',
    category = 'Uncategorized',
    totalTrades = 0,
    successRate = 0,
    pnlPercentage = 0,
    description = 'No description available'
  } = trader;

  const truncatedAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
  
  return (
    <Card className="bg-black/80 border border-white/20 hover:border-white/40 transition-all duration-300">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg font-bold text-white">
              {name}
            </CardTitle>
            <p className="text-sm text-white/60">{truncatedAddress}</p>
          </div>
          <span className="px-2 py-1 text-xs rounded-full bg-white/10 text-white/80">
            {category}
          </span>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center p-2 bg-white/5 rounded-lg">
            <div className="text-sm text-white/60">Trades</div>
            <div className="text-lg font-semibold text-white">{totalTrades}</div>
          </div>
          
          <div className="text-center p-2 bg-white/5 rounded-lg">
            <div className="text-sm text-white/60">Success</div>
            <div className="text-lg font-semibold text-white">{successRate}%</div>
          </div>
          
          <div className="text-center p-2 bg-white/5 rounded-lg">
            <div className="text-sm text-white/60">PNL</div>
            <div className={`text-lg font-semibold ${pnlPercentage >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {pnlPercentage >= 0 ? '+' : ''}{pnlPercentage}%
            </div>
          </div>
        </div>
        
        <p className="text-sm text-white/70 line-clamp-2">{description}</p>
      </CardContent>
      
      <CardFooter>
        {isFollowed ? (
          <button
            onClick={onUnfollow}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                     bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <FaUserCheck />
            <span>Unfollow</span>
          </button>
        ) : (
          <button
            onClick={onFollow}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                     bg-gradient-to-r from-blue-500 to-blue-600 text-white 
                     hover:from-blue-600 hover:to-blue-700 transition-colors"
          >
            <FaUserPlus />
            <span>Follow</span>
          </button>
        )}
      </CardFooter>
    </Card>
  );
};

export default CopyTraderCard; 