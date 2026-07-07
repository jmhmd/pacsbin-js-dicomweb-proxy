import { readFileSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import { ProxyConfig } from '../types';
import { validateConfig } from './validation';
import { restoreMaskedSecrets, updateJsoncConfig } from './jsonc-writer';
import { logger } from '../utils/logger';

export class ConfigManager {
  private config: ProxyConfig | null = null;
  private configPath: string | null = null;

  constructor(configPath?: string) {
    // Resolution order: explicit CLI arg → CONFIG_PATH env → conventional search.
    this.configPath =
      configPath ?? process.env['CONFIG_PATH'] ?? this.findConfigFile();
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
    return this.configPath ? resolve(this.configPath) : null;
  }

  public updateConfig(newConfig: ProxyConfig): void {
    const currentConfig = this.config;

    // Restore any masked secrets (***CONFIGURED***) coming back from the
    // sanitized /config/current view so we never overwrite real cert paths /
    // passwords with the placeholder string.
    const restored = currentConfig
      ? restoreMaskedSecrets(newConfig, currentConfig)
      : newConfig;

    // Validate the new configuration
    const validatedConfig = validateConfig(restored);

    // Create backup of current config before updating
    this.createConfigBackup();

    // Update the configuration file (preserving comments where possible)
    this.writeConfigFile(validatedConfig, currentConfig);

    // Reload the configuration in memory
    this.config = validatedConfig;
  }

  public testConfig(configData: any): ProxyConfig {
    const restored = this.config
      ? restoreMaskedSecrets(configData, this.config)
      : configData;
    return validateConfig(restored);
  }

  private createConfigBackup(): void {
    if (!this.configPath || !existsSync(this.configPath)) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.configPath}.backup-${timestamp}`;

    try {
      copyFileSync(this.configPath, backupPath);
      logger.info(`Configuration backup created: ${backupPath}`);
    } catch (error) {
      logger.warn(`Failed to create config backup: ${error}`);
    }
  }

  private writeConfigFile(config: ProxyConfig, currentConfig?: ProxyConfig | null): void {
    if (!this.configPath) {
      throw new Error('No configuration file path available for writing');
    }

    try {
      let outputText: string;

      // Preserve comments/formatting by editing only the changed fields of the
      // existing file when we have both the original text and the prior config.
      if (currentConfig && existsSync(this.configPath)) {
        try {
          const originalText = readFileSync(this.configPath, 'utf-8');
          outputText = updateJsoncConfig(originalText, config, currentConfig);
        } catch (editError) {
          logger.warn(
            `Comment-preserving config write failed, falling back to full rewrite: ${editError}`
          );
          outputText = JSON.stringify(config, null, 2);
        }
      } else {
        outputText = JSON.stringify(config, null, 2);
      }

      writeFileSync(this.configPath, outputText, 'utf-8');
      logger.info(`Configuration updated: ${this.configPath}`);
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
    if (sanitized.dashboardAuth?.password) {
      sanitized.dashboardAuth.password = '***CONFIGURED***';
    }

    return sanitized;
  }
}