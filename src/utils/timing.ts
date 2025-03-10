/**
 * Utility for measuring and logging execution time of operations
 */

// Store active timers
const timers: Record<string, number> = {};

/**
 * Start a timer with the given label
 * @param label Unique identifier for this timer
 */
export function startTimer(label: string): void {
  timers[label] = performance.now();
  console.log(`⏱️ [${label}] Started`);
}

/**
 * Stop a timer and return the elapsed time in milliseconds
 * @param label The timer identifier
 * @param log Whether to log the result (default: true)
 * @returns Elapsed time in milliseconds
 */
export function stopTimer(label: string, log: boolean = true): number {
  if (!timers[label]) {
    console.warn(`Timer "${label}" was never started`);
    return 0;
  }
  
  const elapsed = performance.now() - timers[label];
  const formattedTime = formatTime(elapsed);
  
  if (log) {
    console.log(`⏱️ [${label}] Completed in ${formattedTime}`);
  }
  
  delete timers[label];
  return elapsed;
}

/**
 * Format milliseconds into a human-readable string
 * @param ms Time in milliseconds
 * @returns Formatted time string
 */
function formatTime(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Measure the execution time of an async function
 * @param label Label for the timer
 * @param fn Function to measure
 * @returns Result of the function
 */
export async function measureAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  startTimer(label);
  try {
    return await fn();
  } finally {
    stopTimer(label);
  }
}

/**
 * Measure the execution time of a synchronous function
 * @param label Label for the timer
 * @param fn Function to measure
 * @returns Result of the function
 */
export function measure<T>(label: string, fn: () => T): T {
  startTimer(label);
  try {
    return fn();
  } finally {
    stopTimer(label);
  }
} 