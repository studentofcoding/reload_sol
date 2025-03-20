import { Metadata } from 'next';
import { headers } from 'next/headers';

// Helper function to extract referral code from different patterns
function getReferralCode(params: { referral?: string[] }, searchParams: { with?: string }): string | null {
  // First try path-based referral (@username)
  const pathReferral = params.referral?.[0]?.replace('@', '');
  
  // Then try query-based referral (?with=username)
  const queryReferral = searchParams.with;
  
  // Return the first valid referral code found
  return pathReferral || queryReferral || null;
}

// Generate metadata for both root and referral routes
export async function generateMetadata({ 
  params,
  searchParams,
}: { 
  params: { referral?: string[] },
  searchParams: { with?: string }
}): Promise<Metadata> {
  const referralCode = getReferralCode(params, searchParams);
  
  const baseMetadata = {
    title: 'ReloadSOL - 3 click tools to reload your Solana',
    description: 'Easily reload your Solana tokens in just 3 clicks. Convert dust tokens and useless tokens back to SOL.',
    openGraph: {
      title: 'ReloadSOL - 3 click tools to reload your Solana',
      description: 'Easily reload your Solana tokens in just 3 clicks. Convert dust tokens and useless tokens back to SOL.',
      url: 'https://reloadsol.xyz',
      siteName: 'ReloadSOL',
      locale: 'en-US',
      type: 'website',
      images: [
        {
          url: '/og-image.jpg',
          width: 1200,
          height: 630,
          alt: 'ReloadSOL - 3 click tools to reload your Solana',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'ReloadSOL - 3 click tools to reload your Solana',
      description: 'Easily reload your Solana tokens in just 3 clicks. Convert dust tokens and useless tokens back to SOL.',
      images: ['/og-image.jpg'],
    },
    // Add additional SEO-friendly metadata
    keywords: 'Solana, SOL, dust tokens, token converter, crypto tools, blockchain, DeFi',
    authors: [{ name: 'ReloadSOL Team' }],
    metadataBase: new URL('https://reloadsol.xyz'),
    robots: {
      index: true,
      follow: true,
    },
  };

  // If there's a referral code, modify the metadata
  if (referralCode) {
    const referralUrl = `https://reloadsol.xyz/@${referralCode}`;
    return {
      ...baseMetadata,
      title: `ReloadSOL - Reload your Solana with ${referralCode}`,
      description: `Join ReloadSOL through ${referralCode}'s referral and convert your dust tokens to SOL in just 3 clicks`,
      openGraph: {
        ...baseMetadata.openGraph,
        title: `ReloadSOL - Reload your Solana with ${referralCode}`,
        description: `Join ReloadSOL through ${referralCode}'s referral and convert your dust tokens to SOL in just 3 clicks`,
        url: referralUrl,
      },
      twitter: {
        ...baseMetadata.twitter,
        title: `ReloadSOL - Reload your Solana with ${referralCode}`,
        description: `Join ReloadSOL through ${referralCode}'s referral and convert your dust tokens to SOL in just 3 clicks`,
      },
      alternates: {
        canonical: referralUrl,
      },
    };
  }

  return baseMetadata;
}

export default function Home({ 
  params,
  searchParams,
}: { 
  params: { referral?: string[] },
  searchParams: { with?: string }
}) {
  const referralCode = getReferralCode(params, searchParams);
  
  return (
    <div className="relative">
      <div className="fixed inset-0 bg-gradient-to-b from-black via-gray-900 to-black opacity-30 z-0" />
    </div>
  );
} 