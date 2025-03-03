'use client';

import { FC, useContext, useState, useEffect } from "react";
import Link from "next/link";
import ConnectButton from "@/components/ConnectButton";
import UserContext from "@/contexts/usercontext";
import { useWallet } from "@solana/wallet-adapter-react";
import { isDevWallet } from "@/config/devWallets";
import { FaCoins } from 'react-icons/fa';
import { supabase } from '@/utils/supabase';
import { fetchWalletStats } from '@/utils/stats';

const Header: FC = () => {
  const { publicKey } = useWallet();
  const { tokeBalance } = useContext<any>(UserContext);
  const isDevUser = publicKey ? isDevWallet(publicKey.toBase58()) : false;
  const [points, setPoints] = useState(0);

  useEffect(() => {
    const updateStats = async () => {
      if (publicKey) {
        const stats = await fetchWalletStats(publicKey.toBase58());
        setPoints(stats.points);
      } else {
        setPoints(0);
      }
    };
    
    updateStats();
  }, [publicKey]);

  return (
    <header className="w-full border-b border-white/30 backdrop-blur-sm bg-black/80 relative z-40">
      <div className="container h-20 flex items-center max-w-4xl justify-between">
        <div className="flex items-center gap-6">
          <Link 
            href="/" 
            className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300"
          >
            ReloadSOL
          </Link>
          
          {isDevUser && (
            <Link 
              href="https://analytic.reloadsol.xyz/"
              target="_blank"
              rel="noopener noreferrer"
              className="secondary-button py-2 hidden md:block"
            >
              Analytics
            </Link>
          )}
        </div>
        
        <div className="flex items-center gap-6">
          {publicKey && (
            <button 
              className="flex items-center gap-1 md:gap-2 px-2 md:px-4 py-1 md:py-2 rounded-full
                         bg-gradient-to-r from-white/20 to-white/10
                         border border-white/30 hover:border-white/50
                         transition-all duration-300 group text-sm md:text-base"
            >
              <span className="font-bold text-white">
                {points} Points
              </span>
            </button>
          )}
          <ConnectButton />
        </div>
      </div>
    </header>
  );
};

export default Header;
