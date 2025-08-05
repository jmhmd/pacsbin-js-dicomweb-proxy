import { FileCache } from './file-cache';
import { formatBytes } from '../utils/format';

export class CacheCleanupService {
  private cache: FileCache;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private intervalMinutes: number;

  constructor(cache: FileCache, intervalMinutes: number = 15) {
    this.cache = cache;
    this.intervalMinutes = intervalMinutes;
  }

  public start(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performCleanup();
      } catch (error) {
        console.error('Cache cleanup failed:', error);
      }
    }, this.intervalMinutes * 60 * 1000);

    console.log(`Cache cleanup service started (interval: ${this.intervalMinutes} minutes)`);
  }

  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('Cache cleanup service stopped');
    }
  }

  private async performCleanup(): Promise<void> {
    const startTime = Date.now();
    const beforeStats = this.cache.getStats();
    
    await this.cache.cleanup();
    
    const afterStats = this.cache.getStats();
    const duration = Date.now() - startTime;
    const freedBytes = beforeStats.totalSize - afterStats.totalSize;
    const freedEntries = beforeStats.entryCount - afterStats.entryCount;
    
    if (freedBytes > 0 || freedEntries > 0) {
      console.log(`Cache cleanup completed in ${duration}ms: freed ${formatBytes(freedBytes)} (${freedEntries} entries)`);
    }
  }


  public async performManualCleanup(): Promise<{ freedBytes: number; freedEntries: number; duration: number }> {
    const startTime = Date.now();
    const beforeStats = this.cache.getStats();
    
    await this.cache.cleanup();
    
    const afterStats = this.cache.getStats();
    const duration = Date.now() - startTime;
    const freedBytes = beforeStats.totalSize - afterStats.totalSize;
    const freedEntries = beforeStats.entryCount - afterStats.entryCount;
    
    return {
      freedBytes,
      freedEntries,
      duration
    };
  }
}