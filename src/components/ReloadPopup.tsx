'use client';

import { FC, useRef } from 'react';
import { FaTimes, FaTwitter } from 'react-icons/fa';
import html2canvas from 'html2canvas';

interface ReloadPopupProps {
  isOpen: boolean;
  onClose: () => void;
  tokenCount: number;
  solAmount: number;
  isSwap?: boolean;
  dustValue?: number;
}

const ReloadPopup: FC<ReloadPopupProps> = ({ 
  isOpen, 
  onClose, 
  tokenCount,
  solAmount,
  isSwap = false,
  dustValue = 0
}) => {
  const popupRef = useRef<HTMLDivElement>(null);

  const shareToTwitter = () => {
    const url = 'https://reloadsol.xyz';
    const text = isSwap 
      ? `🎯 Just reloaded my SOL on @reloadsol!\n\n💎 Join our community:\nWebsite: ${url}\nTelegram: https://t.me/+qIpGWaw6bXwzMWVl`
      : `🎯 Just reloaded my SOL on @reloadsol!\n\n💎 Join our community:\nWebsite: ${url}\nTelegram: https://t.me/+qIpGWaw6bXwzMWVl`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`);
  };

  const downloadImage = async () => {
    if (!popupRef.current) return;
    
    try {
      const canvas = await html2canvas(popupRef.current);
      const link = document.createElement('a');
      link.download = 'reload-success.png';
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
        <div className="absolute inset-0 bg-gradient-radial from-blue-500/20 via-blue-400/10 to-transparent animate-pulse" />
        
        <div className="relative bg-gradient-to-br from-zinc-900 to-neutral-900 p-8 rounded-2xl border border-blue-500/20 shadow-xl">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <FaTimes size={24} />
          </button>

          <div className="text-center">
            <div className="mb-8 relative">
              <div className="success-badge">
                <svg className="w-28 h-28 mx-auto" viewBox="0 0 100 100">
                  <circle 
                    cx="50" cy="50" r="45" 
                    className="stroke-blue-500 stroke-2 fill-none"
                  />
                  <path
                    d="M30 50l15 15l25-25"
                    className="stroke-blue-500 stroke-4 fill-none"
                  />
                </svg>
              </div>
            </div>

            <h2 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-blue-600 mb-6">
              🎯 Reload Success!
            </h2>

            <p className="text-xl text-white/90 mb-4">
              You&apos;ve successfully reloaded, check your wallet
            </p>
            {/* <div className="text-4xl font-bold text-blue-400 mb-2">
              {solAmount.toFixed(3)} SOL
            </div>
            
            {isSwap && dustValue > 0 && (
              <p className="text-sm text-white/70 mb-4">
                Including {dustValue.toFixed(3)} SOL from dust tokens
              </p>
            )} */}

            <div className="flex justify-center gap-4 mt-8">
              <button
                onClick={shareToTwitter}
                className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#1DA1F2] text-white hover:bg-[#1a8cd8] transition-colors"
              >
                <FaTwitter />
                Share Achievement
              </button>
              
              <button
                onClick={downloadImage}
                className="flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Download Image
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReloadPopup; 