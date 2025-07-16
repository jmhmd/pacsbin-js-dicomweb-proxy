import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { isAbsolute } from 'node:path';
import { ProxyConfig } from '../../types';

export interface SslOptions {
  key: string;
  cert: string;
  // Additional options for better SSL compatibility
  secureProtocol?: string;
  honorCipherOrder?: boolean;
  ciphers?: string;
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

    console.log(`SSL Debug: Looking for certificate at: ${certPath}`);
    console.log(`SSL Debug: Looking for private key at: ${keyPath}`);

    if (existsSync(certPath) && existsSync(keyPath)) {
      try {
        const cert = readFileSync(certPath, 'utf-8');
        const key = readFileSync(keyPath, 'utf-8');
        
        // Validate certificate format
        if (!cert.includes('-----BEGIN CERTIFICATE-----')) {
          throw new Error('Certificate file does not contain valid PEM certificate');
        }
        
        if (!key.includes('-----BEGIN PRIVATE KEY-----') && 
            !key.includes('-----BEGIN RSA PRIVATE KEY-----') &&
            !key.includes('-----BEGIN EC PRIVATE KEY-----')) {
          throw new Error('Private key file does not contain valid PEM private key');
        }

        console.log('SSL Debug: Certificate and key files loaded successfully');

        return {
          cert: cert,
          key: key,
          // Enhanced SSL options for better compatibility with mkcert
          // secureProtocol: 'TLSv1_2_method',
          // honorCipherOrder: true,
          // ciphers: [
          //   'ECDHE-RSA-AES128-GCM-SHA256',
          //   'ECDHE-RSA-AES256-GCM-SHA384',
          //   'ECDHE-RSA-AES128-SHA256',
          //   'ECDHE-RSA-AES256-SHA384',
          //   'ECDHE-RSA-AES128-SHA',
          //   'ECDHE-RSA-AES256-SHA',
          //   'AES128-GCM-SHA256',
          //   'AES256-GCM-SHA384',
          //   'AES128-SHA256',
          //   'AES256-SHA256',
          //   'AES128-SHA',
          //   'AES256-SHA'
          // ].join(':')
        };
      } catch (error: any) {
        throw new Error(`Failed to load SSL certificate files: ${error.message}`);
      }
    }

    if (this.config.generateSelfSigned) {
      return this.generateSelfSignedCertificate();
    }

    throw new Error(`SSL certificate files not found at ${certPath} and ${keyPath}`);
  }

  private resolvePath(path: string): string {
    // Since we now require absolute paths in validation, this should always be absolute
    if (isAbsolute(path)) {
      return path;
    }
    
    // Fallback for relative paths (legacy support)
    if (path.startsWith('./')) {
      const executableDir = dirname(process.cwd());
      return join(executableDir, path.substring(2));
    }
    
    // Assume relative to current working directory
    return join(process.cwd(), path);
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
      const { createHash } = require('node:crypto');

      const certHash = createHash('sha256').update(cert).digest('hex');
      const keyHash = createHash('sha256').update(key).digest('hex');

      return certHash.length > 0 && keyHash.length > 0;
    } catch (error) {
      return false;
    }
  }
}