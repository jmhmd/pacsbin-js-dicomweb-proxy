import { Writable } from "node:stream";
import { EventEmitter } from "node:events";

export interface LogEntry {
  timestamp: string;
  level: string;
  msg: string;
  pid: number;
  hostname: string;
  [key: string]: any;
}

export interface LogFilter {
  level?: string | undefined;
  since?: string | undefined;
  search?: string | undefined;
}

export class DashboardLogTransport extends Writable {
  private buffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;
  private readonly maxBufferMemory = 1024 * 1024; // 1MB
  private currentBufferSize = 0;
  private eventEmitter = new EventEmitter();

  constructor() {
    super({ objectMode: true });
  }

  override _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      // Parse the log entry (Pino sends JSON strings)
      const logEntry: LogEntry = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;

      // Add to circular buffer
      this.addToBuffer(logEntry);

      // Emit to connected SSE clients
      this.eventEmitter.emit('log', logEntry);

      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private addToBuffer(entry: LogEntry): void {
    // Estimate size (rough approximation)
    const entrySize = JSON.stringify(entry).length * 2; // Unicode factor

    // Remove old entries if buffer is too large
    while (
      (this.buffer.length >= this.maxBufferSize ||
       this.currentBufferSize + entrySize > this.maxBufferMemory) &&
      this.buffer.length > 0
    ) {
      const removed = this.buffer.shift();
      if (removed) {
        this.currentBufferSize -= JSON.stringify(removed).length * 2;
      }
    }

    // Add new entry
    this.buffer.push(entry);
    this.currentBufferSize += entrySize;
  }

  public getRecentLogs(count: number = 100, filter?: LogFilter): LogEntry[] {
    let logs = [...this.buffer];

    // Apply filters
    if (filter?.level) {
      const levelPriority: Record<string, number> = {
        fatal: 60,
        error: 50,
        warn: 40,
        info: 30,
        debug: 20,
        trace: 10
      };

      const minLevel = levelPriority[filter.level.toLowerCase()] || 0;
      logs = logs.filter(log => (levelPriority[log.level.toLowerCase()] || 0) >= minLevel);
    }

    if (filter?.since) {
      const sinceTime = this.parseSinceFilter(filter.since);
      if (sinceTime) {
        logs = logs.filter(log => new Date(log.timestamp) >= sinceTime);
      }
    }

    if (filter?.search) {
      const searchTerm = filter.search.toLowerCase();
      logs = logs.filter(log =>
        log.msg.toLowerCase().includes(searchTerm) ||
        JSON.stringify(log).toLowerCase().includes(searchTerm)
      );
    }

    // Return most recent entries up to count
    return logs.slice(-count);
  }

  public getAllLogs(filter?: LogFilter, maxLines: number = 10000): LogEntry[] {
    const filtered = this.getRecentLogs(this.buffer.length, filter);
    return filtered.slice(-maxLines);
  }

  public onLog(callback: (log: LogEntry) => void): () => void {
    this.eventEmitter.on('log', callback);

    // Return unsubscribe function
    return () => {
      this.eventEmitter.off('log', callback);
    };
  }

  public getStats(): { bufferSize: number; bufferCount: number; memoryUsage: number } {
    return {
      bufferSize: this.currentBufferSize,
      bufferCount: this.buffer.length,
      memoryUsage: this.currentBufferSize
    };
  }

  private parseSinceFilter(since: string): Date | null {
    const now = new Date();

    // Parse formats like "1h", "30m", "2d", "1w"
    const match = since.match(/^(\d+)([smhdw])$/);
    if (!match) return null;

    const value = parseInt(match[1] || '0');
    const unit = match[2] || '';

    const msPerUnit: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000
    };

    const ms = msPerUnit[unit];
    if (typeof ms !== 'number') return null;

    return new Date(now.getTime() - (value * ms));
  }

  public formatLogsForDownload(logs: LogEntry[], format: 'json' | 'text'): string {
    if (format === 'json') {
      return JSON.stringify(logs, null, 2);
    }

    // Text format matching stdout and web UI display
    return logs.map(log => {
      const timestamp = new Date(log['time'] || log.timestamp || Date.now()).toISOString();
      const level = log.level.toUpperCase().padEnd(5);
      const component = log['component'] ? `[${log['component']}] ` : '';
      const message = log.msg;

      // Build context string from relevant fields
      const excludeKeys = new Set(['time', 'timestamp', 'level', 'msg', 'pid', 'hostname', 'component']);
      const contextParts: string[] = [];
      for (const [key, value] of Object.entries(log)) {
        if (!excludeKeys.has(key)) {
          const formattedValue = typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value);
          contextParts.push(`${key}=${formattedValue}`);
        }
      }
      const context = contextParts.length > 0 ? ` (${contextParts.join(', ')})` : '';

      return `[${timestamp}] ${level} ${component}${message}${context}`;
    }).join('\n');
  }
}