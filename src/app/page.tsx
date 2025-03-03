"use client"

import Header from "@/components/Header";
import TextLoading from "@/components/TextLoading"
import LoadingModal from "@/components/LoadingModal";
import { useContext, useEffect } from "react";
import UserContext from "@/contexts/usercontext";
import { ToastContainer } from "react-toastify";
import Link from 'next/link';
import { FaChartBar, FaExchangeAlt } from 'react-icons/fa';
import { useWallet } from "@solana/wallet-adapter-react";
import { isDevWallet } from "@/config/devWallets";

export default function Home() {
  const { loadingState, textLoadingState } = useContext<any>(UserContext);
  const { publicKey } = useWallet();
  const isDevUser = publicKey ? isDevWallet(publicKey.toBase58()) : false;

  useEffect(() => {
    console.log('[DEBUG] Home page mounted from app directory');
  }, []);

  // Add immediate logging to check if component is being rendered
  console.log('[DEBUG] Rendering Home component from app directory');

  return (
    <div className="flex min-h-screen flex-col bg-black">
      {/* <Header />
      {loadingState && <LoadingModal />}
      {textLoadingState && <TextLoading />}
      <ToastContainer style={{ fontSize: 14 }} /> */}
      
      <div className="flex-1 max-w-7xl mx-auto px-4 py-8 w-full">
        <h1 className="text-4xl font-bold mb-8 text-white">
          {isDevUser ? 'Token Operations Dashboard' : ''}
        </h1>
        
        {isDevUser ? (
          // Dev wallet content
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Link href="/userLeaderboard" 
                  className="bg-gray-800 p-6 rounded-lg hover:bg-gray-700 transition-colors"
                  onClick={() => console.log('[DEBUG] UserLeaderboard link clicked')}>
              <div className="flex items-center space-x-4">
                <div className="bg-white/10 p-4 rounded-lg">
                  <FaChartBar className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-white">User Leaderboard</h2>
                  <p className="text-gray-400">View transaction statistics and top performers</p>
                </div>
              </div>
            </Link>

            <Link href="/transactions" 
                  className="bg-gray-800 p-6 rounded-lg hover:bg-gray-700 transition-colors">
              <div className="flex items-center space-x-4">
                <div className="bg-white/10 p-4 rounded-lg">
                  <FaExchangeAlt className="h-8 w-8 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-white">Transactions</h2>
                  <p className="text-gray-400">Monitor swaps and close operations</p>
                </div>
              </div>
            </Link>
          </div>
        ) : (
          ""
        )}
      </div>
    </div>
  );
}
