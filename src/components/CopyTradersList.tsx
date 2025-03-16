'use client';

import { FC } from 'react';
import CopyTraderCard from './CopyTraderCard';

interface CopyTradersListProps {
  traders: any[];
  followedTraders: string[];
  onFollow: (traderAddress: string) => void;
  onUnfollow: (traderAddress: string) => void;
}

const CopyTradersList: FC<CopyTradersListProps> = ({ 
  traders, 
  followedTraders, 
  onFollow, 
  onUnfollow 
}) => {
  if (traders.length === 0) {
    return (
      <div className="text-center py-8 bg-black/40 rounded-lg border border-white/10">
        <p className="text-white/70">No traders available at the moment.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {traders.map((trader) => (
        <CopyTraderCard
          key={trader.address}
          trader={trader}
          isFollowed={followedTraders.includes(trader.address)}
          onFollow={() => onFollow(trader.address)}
          onUnfollow={() => onUnfollow(trader.address)}
        />
      ))}
    </div>
  );
};

export default CopyTradersList; 