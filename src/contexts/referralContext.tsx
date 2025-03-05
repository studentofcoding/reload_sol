import { createContext, useContext, useState, useEffect } from 'react';
import { isValidReferrer, updateReferrerEarnings, getWalletByAlias } from '@/utils/referral';
import type { ReferralInfo } from '@/types/referral';

interface ReferralContextType {
  referralInfo: ReferralInfo | null;
  setReferralInfo: (info: ReferralInfo | null) => void;
  updateEarnings: (amount: number) => Promise<void>;
}

const ReferralContext = createContext<ReferralContextType>({
  referralInfo: null,
  setReferralInfo: () => {},
  updateEarnings: async () => {},
});

export function ReferralProvider({ children }: { children: React.ReactNode }) {
  const [referralInfo, setReferralInfo] = useState<ReferralInfo | null>(null);

  useEffect(() => {
    const initializeReferral = async () => {
      const path = window.location.pathname;
      const aliasMatch = path.match(/@([^/]+)/)?.[1];
      
      if (aliasMatch) {
        // Get wallet address from alias
        const walletAddress = await getWalletByAlias(aliasMatch);
        
        if (walletAddress) {
          setReferralInfo({
            isActive: true,
            referrerWallet: walletAddress,
            feePercentage: 0.05,
            alias: aliasMatch
          });
          
          // Store both alias and wallet in localStorage
          localStorage.setItem('referrer_alias', aliasMatch);
          localStorage.setItem('referrer_wallet', walletAddress);
        }
      } else {
        // Check localStorage for existing referrer
        const storedAlias = localStorage.getItem('referrer_alias');
        const storedWallet = localStorage.getItem('referrer_wallet');
        
        if (storedAlias && storedWallet) {
          const walletAddress = await getWalletByAlias(storedAlias);
          if (walletAddress === storedWallet) {
            setReferralInfo({
              isActive: true,
              referrerWallet: walletAddress,
              feePercentage: 0.05,
              alias: storedAlias
            });
          } else {
            localStorage.removeItem('referrer_alias');
            localStorage.removeItem('referrer_wallet');
          }
        }
      }
    };

    initializeReferral();
  }, []);

  const updateEarnings = async (amount: number) => {
    if (referralInfo?.isActive) {
      await updateReferrerEarnings(referralInfo.referrerWallet, amount);
    }
  };

  return (
    <ReferralContext.Provider value={{ referralInfo, setReferralInfo, updateEarnings }}>
      {children}
    </ReferralContext.Provider>
  );
}

export const useReferral = () => useContext(ReferralContext); 