import { IncomingMessage, ServerResponse } from "node:http";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { ConfigManager } from "../config/config";
import { RestartManager } from "../server/restart-manager";
import { ProxyConfig, RequestHandler } from "../types";
import { logger } from "../utils/logger";
import { readRequestBody } from "../utils/http-body";

export class ConfigHandler {
  private configManager: ConfigManager;
  private restartManager: RestartManager;

  constructor(configManager: ConfigManager, restartManager: RestartManager) {
    this.configManager = configManager;
    this.restartManager = restartManager;
  }

  public getCurrentConfigHandler(): RequestHandler {
    return async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        const sanitizedConfig = this.configManager.getSanitizedConfig();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sanitizedConfig, null, 2));
      } catch (error) {
        this.sendError(res, 500, 'Failed to retrieve configuration', error);
      }
    };
  }

  public getTestConfigHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        this.sendError(res, 405, 'Method not allowed');
        return;
      }

      try {
        const body = await this.parseRequestBody(req);
        const configData = JSON.parse(body);

        // Test the configuration without applying it
        const validatedConfig = this.configManager.testConfig(configData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Configuration is valid',
          config: validatedConfig
        }));
      } catch (error) {
        this.sendError(res, 400, 'Invalid configuration', error);
      }
    };
  }

  public getUpdateConfigHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        this.sendError(res, 405, 'Method not allowed');
        return;
      }

      if (this.restartManager.isRestartInProgress()) {
        this.sendError(res, 503, 'Restart in progress, please wait');
        return;
      }

      try {
        const body = await this.parseRequestBody(req);
        const { config: newConfig, restartAfterUpdate = true } = JSON.parse(body);

        if (!newConfig) {
          this.sendError(res, 400, 'Configuration data required');
          return;
        }

        // Update the configuration
        this.configManager.updateConfig(newConfig as ProxyConfig);

        const response: any = {
          success: true,
          message: 'Configuration updated successfully',
          timestamp: new Date().toISOString()
        };

        if (restartAfterUpdate) {
          // Initiate graceful restart
          response.message = 'Configuration updated, restarting server...';
          response.restarting = true;

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));

          // Start restart after sending response
          setTimeout(() => {
            this.restartManager.requestRestart({
              gracePeriodMs: 1000,
              reason: 'Configuration update'
            });
          }, 1000);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        }

      } catch (error) {
        this.sendError(res, 400, 'Failed to update configuration', error);
      }
    };
  }

  public getRestartHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        this.sendError(res, 405, 'Method not allowed');
        return;
      }

      if (this.restartManager.isRestartInProgress()) {
        this.sendError(res, 503, 'Restart already in progress');
        return;
      }

      try {
        const body = await this.parseRequestBody(req);
        const { reason = 'Manual restart request' } = body ? JSON.parse(body) : {};

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Restart initiated',
          reason,
          timestamp: new Date().toISOString()
        }));

        // Start restart after sending response
        setTimeout(() => {
          this.restartManager.requestRestart({
            gracePeriodMs: 1000,
            reason
          });
        }, 1000);

      } catch (error) {
        this.sendError(res, 400, 'Invalid request', error);
      }
    };
  }

  public getUploadCertHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        this.sendError(res, 405, 'Method not allowed');
        return;
      }

      try {
        const formData = await this.parseMultipartForm(req);
        const { cert, key, certType = 'ssl' } = formData;

        if (!cert || !key) {
          this.sendError(res, 400, 'Both certificate and key files required');
          return;
        }

        // Determine certificate paths based on current config.
        // Use a `certs` dir that is a SIBLING of the config dir (i.e.
        // <installDir>/certs) to match the installer's convention and its
        // SELinux/permission setup — not nested inside the config dir.
        const currentConfig = this.configManager.getCurrentConfig();
        const configPath = this.configManager.getConfigPath() || './config/config.jsonc';
        const configDir = dirname(resolve(configPath));
        const certsDir = join(dirname(configDir), 'certs');

        // Ensure certs directory exists
        if (!existsSync(certsDir)) {
          mkdirSync(certsDir, { recursive: true });
        }

        const certPath = join(certsDir, `${certType || 'ssl'}.crt`);
        const keyPath = join(certsDir, `${certType || 'ssl'}.key`);

        // Write certificate files
        writeFileSync(certPath, cert);
        writeFileSync(keyPath, key);

        // Update configuration with new certificate paths
        const updatedConfig = { ...currentConfig };
        if (certType === 'ssl') {
          updatedConfig.ssl.certPath = certPath;
          updatedConfig.ssl.keyPath = keyPath;
        }

        // Apply configuration update
        this.configManager.updateConfig(updatedConfig);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Certificates uploaded and configuration updated',
          certPath,
          keyPath,
          timestamp: new Date().toISOString()
        }));

      } catch (error) {
        this.sendError(res, 400, 'Failed to upload certificates', error);
      }
    };
  }

  private async parseRequestBody(req: IncomingMessage): Promise<string> {
    return readRequestBody(req);
  }

  private async parseMultipartForm(req: IncomingMessage): Promise<any> {
    // Simple multipart form parser - in production you might want to use a library
    const body = await this.parseRequestBody(req);
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      // Try to parse as JSON for now
      return JSON.parse(body);
    }

    // Basic multipart parsing (simplified)
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      throw new Error('Invalid multipart form');
    }

    const parts: any = {};
    const sections = body.split(`--${boundary}`);

    for (const section of sections) {
      if (section.includes('Content-Disposition: form-data')) {
        const nameMatch = section.match(/name="([^"]+)"/);
        if (nameMatch && nameMatch[1]) {
          const name = nameMatch[1];
          const contentStart = section.indexOf('\r\n\r\n') + 4;
          const content = section.substring(contentStart).replace(/\r\n$/, '');
          parts[name] = content;
        }
      }
    }

    return parts;
  }

  private sendError(res: ServerResponse, statusCode: number, message: string, error?: any): void {
    logger.error(`Config Handler Error (${statusCode}): ${message}`, error);

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: message,
      statusCode,
      timestamp: new Date().toISOString(),
      ...(error && process.env['NODE_ENV'] === 'development' ? { details: error.message } : {})
    }));
  }
}