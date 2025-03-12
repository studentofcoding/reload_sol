import "@/styles/globals.css"
import { Inter } from "next/font/google"
import type React from "react"
import { Providers } from './providers'
import Navbar from '@/components/Navbar'
import Header from '@/components/Header'
import { Toaster } from 'react-hot-toast'
import Script from 'next/script'
import { ReferralProvider } from '@/contexts/referralContext'

const inter = Inter({ subsets: ["latin"] })

// Create a client component wrapper for the providers
const ClientProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ReferralProvider>
      <Providers>
        {children}
      </Providers>
    </ReferralProvider>
  );
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ClientProviders>
          <div className="min-h-screen bg-black">
            <Header />
            <Navbar />
            {children}
            <Script src="https://scripts.simpleanalyticscdn.com/latest.js" />
          </div>
        </ClientProviders>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
