import { readFileSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

  public updateConfig(newConfig: ProxyConfig): void {
    // Validate the new configuration
    const validatedConfig = validateConfig(newConfig);

    // Create backup of current config before updating
    this.createConfigBackup();

    // Update the configuration file
    this.writeConfigFile(validatedConfig);

    // Reload the configuration in memory
    this.config = validatedConfig;
  }

  public testConfig(configData: any): ProxyConfig {
    return validateConfig(configData);
  }

  private createConfigBackup(): void {
    if (!this.configPath || !existsSync(this.configPath)) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.configPath}.backup-${timestamp}`;

    try {
      copyFileSync(this.configPath, backupPath);
      console.log(`Configuration backup created: ${backupPath}`);
    } catch (error) {
      console.warn(`Failed to create config backup: ${error}`);
    }
  }

  private writeConfigFile(config: ProxyConfig): void {
    if (!this.configPath) {
      throw new Error('No configuration file path available for writing');
    }

    const configJson = JSON.stringify(config, null, 2);

    try {
      writeFileSync(this.configPath, configJson, 'utf-8');
      console.log(`Configuration updated: ${this.configPath}`);
    } catch (error) {
      throw new Error(`Failed to write configuration file: ${error}`);
    }
  }

  public getCurrentConfig(): ProxyConfig {
    return this.getConfig();
  }

  public getSanitizedConfig(): any {
    const config = this.getConfig();

    // Create a sanitized version that removes sensitive information
    const sanitized = JSON.parse(JSON.stringify(config));

    // Remove or mask sensitive fields
    if (sanitized.ssl && sanitized.ssl.keyPath) {
      sanitized.ssl.keyPath = '***CONFIGURED***';
    }
    if (sanitized.ssl && sanitized.ssl.certPath) {
      sanitized.ssl.certPath = '***CONFIGURED***';
    }
    if (sanitized.dimseProxySettings?.proxyServer?.securityOptions) {
      const secOpts = sanitized.dimseProxySettings.proxyServer.securityOptions;
      if (secOpts.key) secOpts.key = '***CONFIGURED***';
      if (secOpts.cert) secOpts.cert = '***CONFIGURED***';
      if (secOpts.ca) secOpts.ca = '***CONFIGURED***';
    }

    return sanitized;
  }
}