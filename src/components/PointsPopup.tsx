'use client';

import { FC, useRef, useEffect } from 'react';
import { FaTimes, FaTwitter, FaTelegram, FaCoins } from 'react-icons/fa';
import html2canvas from 'html2canvas';

interface PointsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  points: number;
  tokenCount: number;
  walletAddress: string;
  userActions: {
    hasSharedTwitter: boolean;
    hasJoinedTelegram: boolean;
  };
  onTwitterShare: () => void;
  onTelegramJoin: () => void;
}

const PointsPopup: FC<PointsPopupProps> = ({ 
  isOpen, 
  onClose, 
  points, 
  tokenCount, 
  walletAddress,
  userActions,
  onTwitterShare,
  onTelegramJoin
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  const shareToTwitter = () => {
    const url = 'https://bit.ly/reloadsol';
    const text = `🎉 Thanks for being alpha user of @reloadsol. You earned ${points} points, Join the community below! 🚀`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`);
    onTwitterShare();
  };

  const joinTGCommunity = () => {
    window.open('https://t.me/+qIpGWaw6bXwzMWVl', '_blank');
    onTelegramJoin();
  };

  const downloadImage = async () => {
    if (!popupRef.current) return;
    
    try {
      const canvas = await html2canvas(popupRef.current);
      const link = document.createElement('a');
      link.download = 'reloadsol-points.png';
      link.href = canvas.toDataURL();
      link.click();
    } catch (error) {
      console.error('Error generating image:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div 
        ref={popupRef}
        className="popup-card relative w-full max-w-lg mx-4 overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-radial from-white/20 via-white/10 to-transparent animate-pulse" />
        
        <div className="relative bg-gradient-to-br from-zinc-900 to-neutral-900 p-8 rounded-2xl border border-white/10 shadow-xl">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <FaTimes size={24} />
          </button>

          <div className="text-center">
            <div className="mb-8 relative">
              <div className="achievement-badge">
                <svg className="w-28 h-28 mx-auto" viewBox="0 0 100 100">
                  <circle 
                    cx="50" cy="50" r="45" 
                    className="stroke-white stroke-2 fill-none"
                  />
                  <path
                    d="M30 50l15 15l25-25"
                    className="stroke-white stroke-4 fill-none"
                  />
                </svg>
              </div>
            </div>

            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300 mb-6">
              🎉 Welcome Alpha User 🎉
            </h2>

            <p className="text-xl text-white/90">
              You have earned
            </p>
            <div className="flex items-center justify-center gap-2 mt-2">
              <FaCoins className="w-6 h-6 text-white" />
              <span className="text-white ml-2">{points} Points</span>
            </div>

            <div className="flex justify-center gap-4 mt-8">
              <button
                onClick={shareToTwitter}
                disabled={userActions.hasSharedTwitter}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                  ${userActions.hasSharedTwitter 
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                    : 'bg-[#1DA1F2] text-white hover:bg-[#1a8cd8]'}`}
              >
                <FaTwitter />
                {userActions.hasSharedTwitter ? 'Shared' : 'Share'}
              </button>
              
              <button
                onClick={joinTGCommunity}
                disabled={userActions.hasJoinedTelegram}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
                  ${userActions.hasJoinedTelegram
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-700 text-white hover:bg-gray-600'}`}
              >
                <FaTelegram />
                {userActions.hasJoinedTelegram ? 'Joined' : 'Join and support the community'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PointsPopup;