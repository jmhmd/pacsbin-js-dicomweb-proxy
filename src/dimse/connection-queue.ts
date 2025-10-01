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

  constructor(private maxConcurrent: number = 10) {}

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
    // Check if we can process more requests
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const request = this.queue.shift();
    if (!request) return;

    this.activeCount++;

    try {
      const result = await request.execute();
      request.resolve(result);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.activeCount--;
      // Process next item in queue
      this.processQueue();
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
