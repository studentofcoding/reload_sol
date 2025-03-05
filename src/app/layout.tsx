import "@/styles/globals.css"
import { Inter } from "next/font/google"
import type React from "react"
import { Providers } from './providers'
import Navbar from '@/components/Navbar'
import Header from '@/components/Header'
import { Toaster } from 'react-hot-toast'
import Script from 'next/script'
import { headers } from 'next/headers'

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "ReloadSOL",
  description: "Swap all your useless tokens and Reload your SOL",
};

function getReferralFromPath(path: string): string | null {
  const match = path.match(/@([^/]+)/);
  return match ? match[1] : null;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <div className="min-h-screen bg-black">
            <Header />
            <Navbar />
            {children}
            <Script src="https://scripts.simpleanalyticscdn.com/latest.js"  />
          </div>
        </Providers>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
