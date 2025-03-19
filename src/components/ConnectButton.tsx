"use client";
import { FC, useContext, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowLine, ExitIcon, WalletIcon } from "./SvgIcon";
import UserContext from "@/contexts/usercontext";
import { Connection } from "@solana/web3.js";
import { updateWalletBalance } from "@/utils/supabase";
import LoadingSpinner from "./LoadingSpinner";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second delay between retries

const ConnectButton: FC = () => {
  const { setTokenList, setLoadingState, swapState, setSwapState, setTokenCounts, userCurrency } = useContext<any>(UserContext);
  const { setVisible } = useWalletModal();
  const { publicKey, disconnect } = useWallet();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (publicKey) {
      const getBalanceWithRetry = async (retries = 0): Promise<number> => {
        try {
          const connection = new Connection(
            process.env.NEXT_PUBLIC_SOLANA_RPC!,
            { commitment: 'confirmed' }
          );
          
          const balance = await connection.getBalance(publicKey, 'confirmed');
          return balance;
        } catch (error) {
          console.warn(`Balance fetch attempt ${retries + 1} failed:`, error);
          
          if (retries < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return getBalanceWithRetry(retries + 1);
          }
          
          console.error('Failed to fetch balance after all retries');
          return 0; // Return 0 as fallback
        }
      };

      const trackBalance = async () => {
        try {
          const balance = await getBalanceWithRetry();
          const solBalance = balance / 1e9; // Convert lamports to SOL
          await updateWalletBalance(publicKey.toBase58(), solBalance);
        } catch (error) {
          console.error('Error in trackBalance:', error);
        }
      };
      
      trackBalance();
      const interval = setInterval(trackBalance, 60000); // Update every minute
      return () => clearInterval(interval);
    }
  }, [publicKey]);

  const handleDisconnect = async () => {
    console.log('[DEBUG] Disconnecting wallet');
    try {
      await disconnect();
      setTokenList([]);
      console.log('[DEBUG] Wallet disconnected successfully');
    } catch (error) {
      console.error('[ERROR] Failed to disconnect wallet:', error);
    }
  };

  const handleMenuToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[DEBUG] Menu toggle clicked');
    setIsMenuOpen(!isMenuOpen);
  };

  const handleChangeWallet = () => {
    console.log('[DEBUG] Change wallet clicked');
    setVisible(true);
    setIsMenuOpen(false);
  };

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const menuContainer = document.querySelector('.wallet-menu-container');
      
      if (menuContainer && !menuContainer.contains(target)) {
        console.log('[DEBUG] Valid outside click detected');
        setIsMenuOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isMenuOpen]);

  return (
    <div className="rounded-lg border-[0.75px] border-white/30 bg-black/80 shadow-btn-inner text-white tracking-[0.32px] py-2 px-2 w-[140px] lg:w-[180px] group relative cursor-pointer">
      {publicKey ? (
        <>
          <div className="flex items-center justify-center text-[10px] lg:text-[14px] gap-2">
            {isLoading ? (
              <div className="flex items-center gap-2">
                <LoadingSpinner size="sm" />
                <span>Loading...</span>
              </div>
            ) : (
              <>
                <span>{publicKey.toBase58().slice(0, 4)}....{publicKey.toBase58().slice(-4)}</span>
                <div className="rotate-90 w-3 h-3">
                  <ArrowLine />
                </div>
              </>
            )}
          </div>
          
          <div className="w-[200px] absolute right-0 top-10 hidden group-hover:block z-50">
            <ul className="border-[0.75px] border-white/30 rounded-lg bg-black/90 p-2 mt-2 backdrop-blur-md shadow-xl">
              <li>
                <button
                  onClick={() => setVisible(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 rounded-lg
                           hover:bg-white/10 transition-colors text-left text-white"
                  disabled={isLoading}
                >
                  <WalletIcon />
                  <span>Change Wallets</span>
                </button>
              </li>
              <li>
                <button
                  onClick={handleDisconnect}
                  className="w-full flex items-center gap-2 px-4 py-2 rounded-lg
                           hover:bg-white/10 transition-colors text-left
                           text-red-400 hover:text-red-300"
                  disabled={isLoading}
                >
                  <ExitIcon />
                  <span>Disconnect</span>
                </button>
              </li>
            </ul>
          </div>
        </>
      ) : (
        <button
          className="flex items-center justify-center text-[10px] lg:text-[14px] w-full"
          onClick={() => setVisible(true)}
        >
          {userCurrency === 'USD' ? 'Check my wallet' : 'Cek wallet saya'}
          <div className="rotate-90 w-3 h-3 ml-2">
            <ArrowLine />
          </div>
        </button>
      )}
    </div>
  );
};

export default ConnectButton;
