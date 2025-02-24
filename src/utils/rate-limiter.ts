export class RateLimiter {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private lastRequest = 0;
  private requestsPerSecond: number;

  constructor(requestsPerSecond: number) {
    this.requestsPerSecond = requestsPerSecond;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const delay = Math.max(0, (1000 / this.requestsPerSecond) - (now - this.lastRequest));
      
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const fn = this.queue.shift();
      if (fn) {
        this.lastRequest = Date.now();
        await fn();
      }
    }

    this.processing = false;
  }
}