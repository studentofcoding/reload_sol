import "@/styles/globals.css"
import type React from "react"
import { Providers } from './providers'
import Navbar from '@/components/Navbar'
import Header from '@/components/Header'

export const metadata = {
  title: "ReloadSOL",
  description: "Swap all your useless tokens and Reload your SOL",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black antialiased">
        <Providers>
          <div className="min-h-screen bg-black">
            <Header />
            <Navbar />
          </div>
        </Providers>
      </body>
    </html>
  );
}
