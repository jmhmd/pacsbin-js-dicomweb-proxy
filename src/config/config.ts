import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseJsonc } from 'jsonc-parser';
import { ProxyConfig } from '../types';
import { validateConfig } from './validation';

export class ConfigManager {
  private config: ProxyConfig | null = null;
  private configPath: string | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath ?? this.findConfigFile();
    this.loadConfig();
  }

  private findConfigFile(): string {
    const possiblePaths = [
      './config.json',
      './config.jsonc',
      './config/config.json',
      './config/config.jsonc',
      join(process.cwd(), 'config.json'),
      join(process.cwd(), 'config.jsonc'),
      join(process.cwd(), 'config', 'config.json'),
      join(process.cwd(), 'config', 'config.jsonc'),
    ];

    const executableDir = dirname(process.argv[0] || process.cwd());
    possiblePaths.unshift(
      join(executableDir, 'config.json'),
      join(executableDir, 'config.jsonc'),
      join(executableDir, 'config', 'config.json'),
      join(executableDir, 'config', 'config.jsonc')
    );

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        return path;
      }
    }

    throw new Error(`Configuration file not found. Searched paths:\n${possiblePaths.join('\n')}`);
  }

  private loadConfig(): void {
    if (!this.configPath) {
      throw new Error('No configuration file path specified');
    }

    try {
      const configContent = readFileSync(this.configPath, 'utf-8');
      const rawConfig = this.parseJsonWithComments(configContent);
      this.config = validateConfig(rawConfig);
    } catch (error) {
      throw new Error(`Failed to load configuration from ${this.configPath}: ${error}`);
    }
  }

  private parseJsonWithComments(content: string): any {
    try {
      // First try to parse as regular JSON
      return JSON.parse(content);
    } catch (jsonError) {
      try {
        // If that fails, try to parse as JSONC (JSON with comments)
        return parseJsonc(content);
      } catch (jsoncError) {
        throw new Error(`Failed to parse configuration file as JSON or JSONC: ${jsoncError}`);
      }
    }
  }

  public getConfig(): ProxyConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded');
    }
    return this.config;
  }

  public reloadConfig(): void {
    this.loadConfig();
  }

  public getConfigPath(): string | null {
    return this.configPath;
  }

  public static createDefaultConfig(): ProxyConfig {
    return {
      proxyMode: 'dimse',
      dimseProxySettings: {
        proxyServer: {
          aet: 'PACSBIN_PROXY',
          ip: '0.0.0.0',
          port: 8888,
        },
        peers: [
          {
            aet: 'PACS_SERVER',
            ip: '127.0.0.1',
            port: 11112,
          },
        ],
      },
      logDir: './logs',
      storagePath: './data',
      cacheRetentionMinutes: 60,
      enableCache: true,
      webserverPort: 3006,
      useCget: false,
      useFetchLevel: 'SERIES',
      maxAssociations: 4,
      qidoMinChars: 0,
      qidoAppendWildcard: true,
      verboseLogging: false,
      ssl: {
        enabled: false,
        port: 443,
        certPath: './certs/server.crt',
        keyPath: './certs/server.key',
        generateSelfSigned: false,
        redirectHttp: true,
      },
      cors: {
        origin: ['*'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
        credentials: true,
      },
    };
  }
}