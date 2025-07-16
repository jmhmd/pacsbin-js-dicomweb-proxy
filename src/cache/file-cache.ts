import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { CacheEntry } from '../types';

export class FileCache {
  private cachePath: string;
  private retentionMinutes: number;
  private maxSizeBytes: number;
  private indexPath: string;
  private index: Map<string, CacheEntry> = new Map();

  constructor(cachePath: string, retentionMinutes: number, maxSizeBytes: number = 10 * 1024 * 1024 * 1024) {
    this.cachePath = cachePath;
    this.retentionMinutes = retentionMinutes;
    this.maxSizeBytes = maxSizeBytes;
    this.indexPath = join(cachePath, 'cache-index.json');
    
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
      console.error('Failed to load cache index:', error);
      this.index = new Map();
    }
  }

  private saveIndex(): void {
    try {
      const indexData: Record<string, any> = {};
      for (const [key, entry] of this.index) {
        indexData[key] = {
          ...entry,
          created: entry.created.toISOString(),
          accessed: entry.accessed.toISOString(),
        };
      }
      writeFileSync(this.indexPath, JSON.stringify(indexData, null, 2));
    } catch (error) {
      console.error('Failed to save cache index:', error);
    }
  }

  private generateCacheKey(studyInstanceUID: string, seriesInstanceUID?: string, sopInstanceUID?: string): string {
    const identifier = sopInstanceUID || seriesInstanceUID || studyInstanceUID;
    return createHash('sha256').update(identifier).digest('hex');
  }

  private getCacheFilePath(key: string): string {
    const subdir = key.substring(0, 2);
    const subdirPath = join(this.cachePath, subdir);
    
    if (!existsSync(subdirPath)) {
      mkdirSync(subdirPath, { recursive: true });
    }
    
    return join(subdirPath, `${key}.dcm`);
  }

  public async store(studyInstanceUID: string, seriesInstanceUID: string, sopInstanceUID: string, data: Buffer): Promise<void> {
    const key = this.generateCacheKey(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    const filePath = this.getCacheFilePath(key);
    
    try {
      writeFileSync(filePath, data);
      
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
      this.saveIndex();
      
      await this.cleanup();
    } catch (error) {
      console.error(`Failed to store cache entry ${key}:`, error);
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
      if (!existsSync(entry.path)) {
        this.index.delete(key);
        this.saveIndex();
        return null;
      }
      
      entry.accessed = new Date();
      this.index.set(key, entry);
      this.saveIndex();
      
      return readFileSync(entry.path);
    } catch (error) {
      console.error(`Failed to retrieve cache entry ${key}:`, error);
      return null;
    }
  }

  public async has(studyInstanceUID: string, seriesInstanceUID?: string, sopInstanceUID?: string): Promise<boolean> {
    const key = this.generateCacheKey(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    const entry = this.index.get(key);
    
    if (!entry) {
      return false;
    }
    
    if (this.isExpired(entry)) {
      await this.remove(key);
      return false;
    }
    
    return existsSync(entry.path);
  }

  public async remove(key: string): Promise<void> {
    const entry = this.index.get(key);
    
    if (entry) {
      try {
        if (existsSync(entry.path)) {
          unlinkSync(entry.path);
        }
      } catch (error) {
        console.error(`Failed to delete cache file ${entry.path}:`, error);
      }
      
      this.index.delete(key);
      this.saveIndex();
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
    return {
      totalSize: this.getTotalSize(),
      entryCount: this.getEntryCount(),
      hitRate: 0,
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
      
      if (existsSync(entry.path)) {
        valid++;
      } else {
        invalid++;
        await this.remove(key);
      }
    }
    
    try {
      const findOrphanedFiles = (dir: string): string[] => {
        const files: string[] = [];
        const entries = readdirSync(dir);
        
        for (const entry of entries) {
          const fullPath = join(dir, entry);
          const stat = statSync(fullPath);
          
          if (stat.isDirectory()) {
            files.push(...findOrphanedFiles(fullPath));
          } else if (entry.endsWith('.dcm')) {
            files.push(fullPath);
          }
        }
        
        return files;
      };
      
      const allFiles = findOrphanedFiles(this.cachePath);
      for (const file of allFiles) {
        if (!indexedPaths.has(file)) {
          orphaned++;
          try {
            unlinkSync(file);
          } catch (error) {
            console.error(`Failed to delete orphaned file ${file}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error validating cache:', error);
    }
    
    return { valid, invalid, orphaned };
  }
}