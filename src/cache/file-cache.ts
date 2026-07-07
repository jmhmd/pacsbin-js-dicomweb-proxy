import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  writeFile,
  readFile,
  unlink,
  mkdir,
  rename,
  readdir,
  stat,
  access,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CacheEntry } from '../types';
import { logger } from '../utils/logger';

export class FileCache {
  private cachePath: string;
  private retentionMinutes: number;
  private maxSizeBytes: number;
  private indexPath: string;
  private index: Map<string, CacheEntry> = new Map();

  // Debounced, atomic index persistence. Every store/retrieve/remove marks the
  // index dirty and schedules a single coalesced write instead of rewriting the
  // whole JSON synchronously on the event loop for each operation.
  private indexDirty = false;
  private indexWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private indexWriting = false;
  private readonly indexWriteDelayMs = 1000;

  // Hit-rate accounting (surfaced via getStats for /health).
  private hits = 0;
  private misses = 0;

  constructor(cachePath: string, retentionMinutes: number, maxSizeBytes: number = 10 * 1024 * 1024 * 1024) {
    this.cachePath = cachePath;
    this.retentionMinutes = retentionMinutes;
    this.maxSizeBytes = maxSizeBytes;
    this.indexPath = join(cachePath, 'cache-index.json');

    // One-time startup work is fine synchronously.
    this.ensureDirectoryExists();
    this.loadIndex();
  }

  private ensureDirectoryExists(): void {
    if (!existsSync(this.cachePath)) {
      mkdirSync(this.cachePath, { recursive: true });
    }
  }

  private loadIndex(): void {
    try {
      if (existsSync(this.indexPath)) {
        const indexData = JSON.parse(readFileSync(this.indexPath, 'utf-8'));
        this.index = new Map(Object.entries(indexData).map(([key, entry]: [string, any]) => [
          key,
          {
            ...entry,
            created: new Date(entry.created),
            accessed: new Date(entry.accessed),
          }
        ]));
      }
    } catch (error) {
      logger.error('Failed to load cache index', error);
      this.index = new Map();
    }
  }

  /**
   * Marks the index dirty and schedules a coalesced write. Multiple mutations
   * within the debounce window result in a single disk write.
   */
  private scheduleIndexSave(): void {
    this.indexDirty = true;
    if (this.indexWriteTimer) {
      return;
    }
    this.indexWriteTimer = setTimeout(() => {
      this.indexWriteTimer = null;
      void this.flushIndex();
    }, this.indexWriteDelayMs);
    if (typeof (this.indexWriteTimer as any).unref === 'function') {
      (this.indexWriteTimer as any).unref();
    }
  }

  /**
   * Writes the index atomically (temp file + rename) so a crash mid-write can't
   * corrupt it. Safe to call directly (e.g. on shutdown) to force a flush.
   */
  public async flushIndex(): Promise<void> {
    if (this.indexWriting || !this.indexDirty) {
      return;
    }
    this.indexWriting = true;
    this.indexDirty = false;
    try {
      const indexData: Record<string, any> = {};
      for (const [key, entry] of this.index) {
        indexData[key] = {
          ...entry,
          created: entry.created.toISOString(),
          accessed: entry.accessed.toISOString(),
        };
      }
      const tmpPath = `${this.indexPath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(indexData));
      await rename(tmpPath, this.indexPath);
    } catch (error) {
      logger.error('Failed to save cache index', error);
      this.indexDirty = true; // retry on next schedule
    } finally {
      this.indexWriting = false;
      if (this.indexDirty) {
        this.scheduleIndexSave();
      }
    }
  }

  private generateCacheKey(studyInstanceUID: string, seriesInstanceUID?: string, sopInstanceUID?: string): string {
    const identifier = sopInstanceUID || seriesInstanceUID || studyInstanceUID;
    return createHash('sha256').update(identifier).digest('hex');
  }

  private getCacheFilePath(key: string): string {
    const subdir = key.substring(0, 2);
    return join(this.cachePath, subdir, `${key}.dcm`);
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  public async store(studyInstanceUID: string, seriesInstanceUID: string, sopInstanceUID: string, data: Buffer): Promise<void> {
    const key = this.generateCacheKey(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    const filePath = this.getCacheFilePath(key);

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, data);

      const entry: CacheEntry = {
        path: filePath,
        size: data.length,
        created: new Date(),
        accessed: new Date(),
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID,
      };

      this.index.set(key, entry);
      this.scheduleIndexSave();

      await this.cleanup();
    } catch (error) {
      logger.error(`Failed to store cache entry ${key}`, error);
      throw error;
    }
  }

  public async retrieve(studyInstanceUID: string, seriesInstanceUID?: string, sopInstanceUID?: string): Promise<Buffer | null> {
    const key = this.generateCacheKey(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    const entry = this.index.get(key);

    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      await this.remove(key);
      return null;
    }

    try {
      if (!(await this.pathExists(entry.path))) {
        this.index.delete(key);
        this.scheduleIndexSave();
        return null;
      }

      entry.accessed = new Date();
      this.index.set(key, entry);
      this.scheduleIndexSave();

      return await readFile(entry.path);
    } catch (error) {
      logger.error(`Failed to retrieve cache entry ${key}`, error);
      return null;
    }
  }

  public async has(studyInstanceUID: string, seriesInstanceUID?: string, sopInstanceUID?: string): Promise<boolean> {
    const key = this.generateCacheKey(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    const entry = this.index.get(key);

    if (!entry) {
      this.misses++;
      return false;
    }

    if (this.isExpired(entry)) {
      await this.remove(key);
      this.misses++;
      return false;
    }

    const present = await this.pathExists(entry.path);
    if (present) {
      this.hits++;
    } else {
      this.misses++;
    }
    return present;
  }

  public async remove(key: string): Promise<void> {
    const entry = this.index.get(key);

    if (entry) {
      try {
        await unlink(entry.path);
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          logger.error(`Failed to delete cache file ${entry.path}`, error);
        }
      }

      this.index.delete(key);
      this.scheduleIndexSave();
    }
  }

  public async cleanup(): Promise<void> {
    const keysToRemove: string[] = [];

    for (const [key, entry] of this.index) {
      if (this.isExpired(entry)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      await this.remove(key);
    }

    await this.enforceMaxSize();
  }

  private isExpired(entry: CacheEntry): boolean {
    const now = new Date();
    const expirationTime = new Date(entry.created.getTime() + this.retentionMinutes * 60 * 1000);
    return now > expirationTime;
  }

  private async enforceMaxSize(): Promise<void> {
    const totalSize = this.getTotalSize();

    if (totalSize <= this.maxSizeBytes) {
      return;
    }

    const sortedEntries = Array.from(this.index.entries())
      .sort(([, a], [, b]) => a.accessed.getTime() - b.accessed.getTime());

    let currentSize = totalSize;
    for (const [key, entry] of sortedEntries) {
      if (currentSize <= this.maxSizeBytes) {
        break;
      }

      await this.remove(key);
      currentSize -= entry.size;
    }
  }

  public getTotalSize(): number {
    return Array.from(this.index.values()).reduce((total, entry) => total + entry.size, 0);
  }

  public getEntryCount(): number {
    return this.index.size;
  }

  public getStats(): { totalSize: number; entryCount: number; hitRate: number } {
    const lookups = this.hits + this.misses;
    return {
      totalSize: this.getTotalSize(),
      entryCount: this.getEntryCount(),
      hitRate: lookups > 0 ? this.hits / lookups : 0,
    };
  }

  public async clear(): Promise<void> {
    const keys = Array.from(this.index.keys());
    for (const key of keys) {
      await this.remove(key);
    }
  }

  public listEntries(): CacheEntry[] {
    return Array.from(this.index.values());
  }

  public async validateCache(): Promise<{ valid: number; invalid: number; orphaned: number }> {
    let valid = 0;
    let invalid = 0;
    let orphaned = 0;

    const indexedPaths = new Set<string>();
    for (const [key, entry] of this.index) {
      indexedPaths.add(entry.path);

      if (await this.pathExists(entry.path)) {
        valid++;
      } else {
        invalid++;
        await this.remove(key);
      }
    }

    try {
      const findOrphanedFiles = async (dir: string): Promise<string[]> => {
        const files: string[] = [];
        const entries = await readdir(dir);

        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const s = await stat(fullPath);

          if (s.isDirectory()) {
            files.push(...(await findOrphanedFiles(fullPath)));
          } else if (entry.endsWith('.dcm')) {
            files.push(fullPath);
          }
        }

        return files;
      };

      const allFiles = await findOrphanedFiles(this.cachePath);
      for (const file of allFiles) {
        if (!indexedPaths.has(file)) {
          orphaned++;
          try {
            await unlink(file);
          } catch (error) {
            logger.error(`Failed to delete orphaned file ${file}`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Error validating cache', error);
    }

    return { valid, invalid, orphaned };
  }
}
