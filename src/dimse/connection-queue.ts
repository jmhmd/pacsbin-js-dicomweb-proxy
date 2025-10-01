/**
 * Connection Queue to limit concurrent DIMSE connections
 *
 * Problem: Creating hundreds of simultaneous DIMSE Client connections causes:
 * - PACS connection limit exhaustion
 * - TCP socket exhaustion
 * - Progressive slowdown as connections queue up
 *
 * Solution: Queue requests and process them with a concurrency limit
 *
 * Note on Association Reuse:
 * The dcmjs-dimse library creates single-use associations - each Client instance
 * opens a connection with send(), processes requests, then closes. We cannot keep
 * associations open for reuse. However, the queue provides backpressure to prevent
 * overwhelming the PACS and exhausting system resources.
 */

interface QueuedRequest<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class ConnectionQueue {
  private queue: QueuedRequest<any>[] = [];
  private activeCount = 0;
  private slotCompletionTimes: number[] = [];
  private isProcessing = false;

  constructor(
    private maxConcurrent: number = 1,
    private delayBetweenRequestsMs: number = 100
  ) {
    // Initialize slot completion times to 0 (available immediately)
    this.slotCompletionTimes = new Array(maxConcurrent).fill(0);
  }

  /**
   * Add a request to the queue and execute when a slot is available
   */
  public async enqueue<T>(execute: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ execute, resolve, reject });

      // Log when queue starts to build up
      if (this.queue.length > 0 && this.queue.length % 10 === 0) {
        console.log(`DIMSE connection queue: ${this.queue.length} waiting, ${this.activeCount}/${this.maxConcurrent} active`);
      }

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    // Prevent concurrent processQueue execution
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    // Can't start more if at capacity
    if (this.activeCount >= this.maxConcurrent) {
      return;
    }

    this.isProcessing = true;

    try {
      // Find the next available slot (earliest one that's ready)
      const now = Date.now();
      let earliestSlot = -1;
      let earliestReadyTime = Infinity;

      for (let i = 0; i < this.maxConcurrent; i++) {
        const completionTime = this.slotCompletionTimes[i] ?? 0;
        const readyTime = completionTime + this.delayBetweenRequestsMs;
        if (readyTime < earliestReadyTime) {
          earliestReadyTime = readyTime;
          earliestSlot = i;
        }
      }

      // Wait until the earliest slot is ready
      if (earliestReadyTime > now) {
        await new Promise(resolve => setTimeout(resolve, earliestReadyTime - now));
      }

      const request = this.queue.shift();
      if (!request) return;

      this.activeCount++;
      const slotIndex = earliestSlot;

      // Execute request without waiting for completion
      request.execute()
        .then(result => request.resolve(result))
        .catch(error => request.reject(error instanceof Error ? error : new Error(String(error))))
        .finally(() => {
          this.activeCount--;
          this.slotCompletionTimes[slotIndex] = Date.now();
          // Trigger processing for next item
          this.processQueue();
        });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get queue statistics
   */
  public getStats(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Update max concurrent connections
   */
  public setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
    // Try to process queue with new limit
    this.processQueue();
  }
}
