import { startTimer, stopTimer } from './timing';

export class RateLimiter {
  private queue: (() => Promise<any>)[] = [];
  private processing = false;
  private requestTimes: number[] = [];
  private requestsPerSecond: number;
  private timeWindow: number;
  private name: string;

  constructor(requestsPerSecond: number, timeWindow: number = 1000, name: string = 'RateLimiter') {
    this.requestsPerSecond = requestsPerSecond;
    this.timeWindow = timeWindow; // Time window in milliseconds (default: 1 second)
    this.name = name;
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const queueLength = this.queue.length;
      const timerLabel = `${this.name} Queue (${queueLength + 1})`;
      
      startTimer(timerLabel);
      
      this.queue.push(async () => {
        try {
          stopTimer(timerLabel);
          const execTimerLabel = `${this.name} Execution`;
          startTimer(execTimerLabel);
          
          const result = await fn();
          
          stopTimer(execTimerLabel);
          resolve(result);
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
      
      // Remove request times that are outside the time window
      this.requestTimes = this.requestTimes.filter(time => now - time < this.timeWindow);
      
      // If we've reached the limit, wait until we can make another request
      if (this.requestTimes.length >= this.requestsPerSecond) {
        const oldestRequest = this.requestTimes[0];
        const timeToWait = oldestRequest + this.timeWindow - now;
        
        if (timeToWait > 0) {
          const waitTimerLabel = `${this.name} Rate Limit Wait`;
          startTimer(waitTimerLabel);
          await new Promise(resolve => setTimeout(resolve, timeToWait));
          stopTimer(waitTimerLabel);
        }
        
        // Update now after waiting
        this.requestTimes = this.requestTimes.filter(time => Date.now() - time < this.timeWindow);
      }

      const fn = this.queue.shift();
      if (fn) {
        this.requestTimes.push(Date.now());
        await fn();
      }
    }

    this.processing = false;
  }
  
  // Add a method to check current queue length
  get queueLength(): number {
    return this.queue.length;
  }
  
  // Add a method to check if we can make immediate requests
  get availableSlots(): number {
    const now = Date.now();
    const activeRequests = this.requestTimes.filter(time => now - time < this.timeWindow).length;
    return Math.max(0, this.requestsPerSecond - activeRequests);
  }
}