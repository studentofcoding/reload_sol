import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'ReloadSOL - Copy Traders',
  description: 'Copy successful Solana traders automatically and boost your returns',
  openGraph: {
    title: 'ReloadSOL - Copy Traders',
    description: 'Copy successful Solana traders automatically and boost your returns',
    url: 'https://reloadsol.xyz/copy-traders',
    siteName: 'ReloadSOL',
    locale: 'en-US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ReloadSOL - Copy Traders',
    description: 'Copy successful Solana traders automatically and boost your returns'
  },
};

export default function CopyTradersPage() {
  redirect('/');
  return null;
} 