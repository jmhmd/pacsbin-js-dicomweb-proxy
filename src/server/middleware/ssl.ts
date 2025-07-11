import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { ProxyConfig } from '../../types';

export interface SslOptions {
  key: string;
  cert: string;
}

export class SslManager {
  private config: ProxyConfig['ssl'];

  constructor(config: ProxyConfig['ssl']) {
    this.config = config;
  }

  public getSslOptions(): SslOptions | null {
    if (!this.config.enabled) {
      return null;
    }

    const certPath = this.resolvePath(this.config.certPath);
    const keyPath = this.resolvePath(this.config.keyPath);

    if (existsSync(certPath) && existsSync(keyPath)) {
      return {
        cert: readFileSync(certPath, 'utf-8'),
        key: readFileSync(keyPath, 'utf-8'),
      };
    }

    if (this.config.generateSelfSigned) {
      return this.generateSelfSignedCertificate();
    }

    throw new Error(`SSL certificate files not found at ${certPath} and ${keyPath}`);
  }

  private resolvePath(path: string): string {
    if (path.startsWith('./')) {
      const executableDir = dirname(/* process.argv[0] ||  */process.cwd());
      return join(executableDir, path.substring(2));
    }
    return path;
  }

  private generateSelfSignedCertificate(): SslOptions {
    const certPath = this.resolvePath(this.config.certPath);
    const keyPath = this.resolvePath(this.config.keyPath);

    const certDir = dirname(certPath);
    const keyDir = dirname(keyPath);

    this.ensureDirectoryExists(certDir);
    if (certDir !== keyDir) {
      this.ensureDirectoryExists(keyDir);
    }

    try {
      const opensslCommand = `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"`;
      execSync(opensslCommand, { stdio: 'ignore' });

      console.log(`Generated self-signed certificate at ${certPath}`);
      console.log(`Generated private key at ${keyPath}`);

      return {
        cert: readFileSync(certPath, 'utf-8'),
        key: readFileSync(keyPath, 'utf-8'),
      };
    } catch (error) {
      throw new Error(`Failed to generate self-signed certificate: ${error}`);
    }
  }

  private ensureDirectoryExists(dirPath: string): void {
    try {
      execSync(`mkdir -p "${dirPath}"`, { stdio: 'ignore' });
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error}`);
    }
  }

  public static validateCertificate(cert: string, key: string): boolean {
    try {
      const { createHash } = require('crypto');

      const certHash = createHash('sha256').update(cert).digest('hex');
      const keyHash = createHash('sha256').update(key).digest('hex');

      return certHash.length > 0 && keyHash.length > 0;
    } catch (error) {
      return false;
    }
  }
}