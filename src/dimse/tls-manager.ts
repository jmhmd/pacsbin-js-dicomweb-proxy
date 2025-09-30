import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join, dirname } from "node:path";
import { ProxyConfig } from "../types";
import { logger } from "../utils/logger";

export interface DimseTlsOptions {
  key: string;
  cert: string;
  ca?: string;
  requestCert?: boolean;
  rejectUnauthorized?: boolean;
  minVersion?: string;
  maxVersion?: string;
  ciphers?: string;
}

type SecurityOptions = NonNullable<NonNullable<ProxyConfig["dimseProxySettings"]>["proxyServer"]["securityOptions"]>;

export class DimseTlsManager {
  private securityOptions: SecurityOptions | undefined;

  constructor(securityOptions?: SecurityOptions) {
    this.securityOptions = securityOptions;
  }

  public getTlsOptions(): DimseTlsOptions | null {
    if (!this.securityOptions) {
      return null;
    }

    const certPath = this.resolvePath(this.securityOptions.cert);
    const keyPath = this.resolvePath(this.securityOptions.key);
    const caPath = this.securityOptions.ca ? this.resolvePath(this.securityOptions.ca) : undefined;

    logger.debug('Looking for certificate', { component: 'DIMSE_TLS', certPath });
    logger.debug('Looking for private key', { component: 'DIMSE_TLS', keyPath });
    if (caPath) {
      logger.debug('Looking for CA certificate', { component: 'DIMSE_TLS', caPath });
    }

    // Validate required files exist
    if (!existsSync(certPath)) {
      throw new Error(`DIMSE TLS certificate file not found: ${certPath}`);
    }
    if (!existsSync(keyPath)) {
      throw new Error(`DIMSE TLS private key file not found: ${keyPath}`);
    }
    if (caPath && !existsSync(caPath)) {
      throw new Error(`DIMSE TLS CA certificate file not found: ${caPath}`);
    }

    try {
      const cert = readFileSync(certPath, "utf-8");
      const key = readFileSync(keyPath, "utf-8");
      const ca = caPath ? readFileSync(caPath, "utf-8") : undefined;

      // Validate certificate format
      if (!cert.includes("-----BEGIN CERTIFICATE-----")) {
        throw new Error("DIMSE TLS certificate file does not contain valid PEM certificate");
      }

      if (
        !key.includes("-----BEGIN PRIVATE KEY-----") &&
        !key.includes("-----BEGIN RSA PRIVATE KEY-----") &&
        !key.includes("-----BEGIN EC PRIVATE KEY-----")
      ) {
        throw new Error("DIMSE TLS private key file does not contain valid PEM private key");
      }

      if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) {
        throw new Error("DIMSE TLS CA certificate file does not contain valid PEM certificate");
      }

      logger.info('Certificate and key files loaded successfully', { component: 'DIMSE_TLS' });

      const tlsOptions: DimseTlsOptions = {
        cert,
        key,
        requestCert: this.securityOptions.requestCert ?? false,
        rejectUnauthorized: this.securityOptions.rejectUnauthorized ?? false,
      };

      // Add optional parameters if provided
      if (ca) {
        tlsOptions.ca = ca;
      }
      if (this.securityOptions.minVersion) {
        tlsOptions.minVersion = this.securityOptions.minVersion;
      }
      if (this.securityOptions.maxVersion) {
        tlsOptions.maxVersion = this.securityOptions.maxVersion;
      }
      if (this.securityOptions.ciphers) {
        tlsOptions.ciphers = this.securityOptions.ciphers;
      }

      return tlsOptions;
    } catch (error: any) {
      throw new Error(`Failed to load DIMSE TLS certificate files: ${error.message}`);
    }
  }

  private resolvePath(path: string): string {
    // Use absolute paths as recommended
    if (isAbsolute(path)) {
      return path;
    }

    // Fallback for relative paths (legacy support)
    if (path.startsWith("./")) {
      const executableDir = dirname(process.cwd());
      return join(executableDir, path.substring(2));
    }

    // Assume relative to current working directory
    return join(process.cwd(), path);
  }

  public isEnabled(): boolean {
    return this.securityOptions !== undefined;
  }
}