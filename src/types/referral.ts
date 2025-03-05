export interface ReferralInfo {
  isActive: boolean;
  referrerWallet: string;
  feePercentage: number;
  alias: string;
}

export const DEFAULT_PLATFORM_FEE = 0.95; // 95% to platform
export const DEFAULT_REFERRAL_FEE = 0.05; // 5% to referrer 