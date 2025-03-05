import { PublicKey } from '@solana/web3.js';
import { supabase } from './supabase';

export interface ReferrerWallet {
  wallet_address: string;
  alias: string;
  is_active: boolean;
  created_at: string;
  total_earned: number;
}

export const isValidAlias = (alias: string): boolean => {
  return /^[a-zA-Z0-9-]{3,20}$/.test(alias);
};

export const getWalletByAlias = async (alias: string): Promise<string | null> => {
  const { data, error } = await supabase
    .from('referral_system_reload')
    .select('wallet_address')
    .eq('alias', alias.toLowerCase())
    .eq('is_active', true)
    .single();

  if (error || !data) {
    console.error('Error fetching wallet by alias:', error);
    return null;
  }

  return data.wallet_address;
};

export async function isValidReferrer(walletAddress: string): Promise<boolean> {
  try {
    // Validate it's a valid Solana address first
    new PublicKey(walletAddress);
    
    // Check if wallet is registered as referrer
    const { data, error } = await supabase
      .from('referral_system_reload')
      .select('is_active')
      .eq('wallet_address', walletAddress)
      .single();

    if (error) {
      console.error('Error checking referrer:', error);
      return false;
    }

    return data?.is_active ?? false;
  } catch (e) {
    console.error('Invalid wallet address:', e);
    return false;
  }
}

export const updateReferrerEarnings = async (walletAddress: string, amount: number): Promise<void> => {
  try {
    const { error } = await supabase.rpc('update_referrer_earnings', {
      p_wallet_address: walletAddress,
      p_amount: amount
    });

    if (error) {
      console.error('Error updating referrer earnings:', error);
    }
  } catch (err) {
    console.error('Failed to update referrer earnings:', err);
  }
}; 