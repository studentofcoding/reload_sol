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
    title: 'ReloadSOL - reload all your empty and dust tokens to SOL',
    description: 'Reload SOL helps you convert dust tokens back to SOL instantly',
    openGraph: {
      title: 'ReloadSOL - reload all your empty and dust tokens to SOL',
      description: 'Reload SOL helps you convert dust tokens back to SOL instantly',
      url: 'https://reloadsol.xyz',
      siteName: 'ReloadSOL',
      locale: 'en-US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'ReloadSOL - reload all your empty and dust tokens to SOL',
      description: 'Reload SOL helps you convert dust tokens back to SOL instantly'
    },
  };

  // If there's a referral code, modify the metadata
  if (referralCode) {
    const referralUrl = `https://reloadsol.xyz/@${referralCode}`;
    return {
      ...baseMetadata,
      title: `ReloadSOL - reload back your sol with ${referralCode}`,
      description: `Join ReloadSOL through ${referralCode}'s referral and get SOL from your dust tokens`,
      openGraph: {
        ...baseMetadata.openGraph,
        title: `ReloadSOL - reload back your sol with ${referralCode}`,
        description: `Join ReloadSOL through ${referralCode}'s referral and get SOL from your dust tokens`,
        url: referralUrl, // Use the canonical @username format
      },
      twitter: {
        ...baseMetadata.twitter,
        title: `ReloadSOL - reload back your sol with ${referralCode}`,
        description: `Join ReloadSOL through ${referralCode}'s referral and get SOL from your dust tokens`,
      },
      // Add canonical URL to ensure consistent referral links
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