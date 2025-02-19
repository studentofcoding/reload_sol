import { Connection } from '@solana/web3.js';

class RPCManager {
  private primaryRPC: string;
  private alternateRPC: string;
  private currentRPC: string;
  private retryCount: number = 0;
  private maxRetries: number = 3;

  constructor() {
    this.primaryRPC = process.env.NEXT_PUBLIC_SOLANA_RPC || '';
    this.alternateRPC = process.env.NEXT_PUBLIC_SOLANA_RPC_ALT || '';
    this.currentRPC = this.primaryRPC;
  }

  getCurrentConnection(): Connection {
    return new Connection(this.currentRPC, "confirmed");
  }

  switchRPC(): Connection {
    this.currentRPC = this.currentRPC === this.primaryRPC ? this.alternateRPC : this.primaryRPC;
    console.log(`Switched to ${this.currentRPC === this.primaryRPC ? 'Primary' : 'Alternate'} RPC`);
    return this.getCurrentConnection();
  }

  async executeWithRetry<T>(operation: (connection: Connection) => Promise<T>): Promise<T> {
    while (this.retryCount < this.maxRetries) {
      try {
        const result = await operation(this.getCurrentConnection());
        this.retryCount = 0; // Reset counter on success
        return result;
      } catch (error: any) {
        const isRateLimitError = 
          error.message?.includes('429') || 
          error.message?.includes('rate limit') ||
          error.message?.includes('Too Many Requests');

        if (isRateLimitError && this.retryCount < this.maxRetries - 1) {
          console.log(`RPC rate limit hit, switching endpoints... (Attempt ${this.retryCount + 1})`);
          this.switchRPC();
          this.retryCount++;
          continue;
        }
        
        throw error; // Rethrow if not a rate limit error or max retries reached
      }
    }

    throw new Error('Max RPC retry attempts reached');
  }

  resetRetryCount() {
    this.retryCount = 0;
  }
}

export const rpcManager = new RPCManager(); 