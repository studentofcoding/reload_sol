export const devWallets = [
  // Add your dev wallet addresses here
  '3V3N5xh6vUUVU3CnbjMAXoyXendfXzXYKzTVEsFrLkgX',
  'FrKWJKLDvTn4ghZSkMXTSERPA7KowWLds2vsMw7QpvNk'
];

export const isDevWallet = (address: string): boolean => {
  const isDev = devWallets.includes(address);
  console.log('Checking dev wallet:', { address, isDev, devWallets });
  return isDev;
};