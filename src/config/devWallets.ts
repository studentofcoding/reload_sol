export const devWallets = [
  // Add your dev wallet addresses here
  '3V3N5xh6vUUVU3CnbjMAXoyXendfXzXYKzTVEsFrLkgX'
];

export const isDevWallet = (address: string): boolean => {
  return devWallets.includes(address);
}; 