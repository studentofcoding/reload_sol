import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { rpcManager } from './rpcManager';

export async function sendFeeTransaction(
  wallet: WalletContextState,
  fromPubkey: PublicKey,
  tokenCount: number
): Promise<boolean> {
  const recipientWallet = process.env.NEXT_PUBLIC_RECIPIENT_WALLET;
  
  if (!recipientWallet) {
    console.warn('Recipient wallet not configured');
    return false;
  }

  try {
    return await rpcManager.executeWithRetry(async (connection) => {
      const transferInstruction = SystemProgram.transfer({
        fromPubkey,
        toPubkey: new PublicKey(recipientWallet),
        lamports: 0.001 * tokenCount * LAMPORTS_PER_SOL,
      });

      const { blockhash } = await connection.getLatestBlockhash();
      
      const messageV0 = new TransactionMessage({
        payerKey: fromPubkey,
        recentBlockhash: blockhash,
        instructions: [transferInstruction],
      }).compileToV0Message();

      const transaction = new VersionedTransaction(messageV0);
      
      const signedTx = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature);
      
      return true;
    });
  } catch (error) {
    console.error('Error sending fee transaction:', error);
    return false;
  }
} 