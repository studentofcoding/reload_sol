import dynamic from 'next/dynamic'
import { SwapWidget } from '../components/SwapWidget'

const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
)

export default function Home() {
  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-end mb-4">
        <WalletMultiButtonDynamic />
      </div>
      <SwapWidget />
    </div>
  )
} 