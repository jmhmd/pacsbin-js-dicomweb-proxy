import { ProxyConfig } from '../types';
import { isAbsolute } from 'node:path';

export function validateConfig(config: any): ProxyConfig {
  const errors: string[] = [];

  if (!config.proxyMode || !['dimse', 'dicomweb'].includes(config.proxyMode)) {
    errors.push('proxyMode must be either "dimse" or "dicomweb"');
  }

  if (config.proxyMode === 'dicomweb') {
    if (!config.dicomwebProxySettings) {
      errors.push('dicomwebProxySettings is required when proxyMode is "dicomweb"');
    } else {
      if (!config.dicomwebProxySettings.qidoForwardingUrl) {
        errors.push('dicomwebProxySettings.qidoForwardingUrl is required');
      }
      if (!config.dicomwebProxySettings.wadoForwardingUrl) {
        errors.push('dicomwebProxySettings.wadoForwardingUrl is required');
      }
    }
  }

  if (config.proxyMode === 'dimse') {
    if (!config.dimseProxySettings) {
      errors.push('dimseProxySettings is required when proxyMode is "dimse"');
    } else {
      const { proxyServer, peers } = config.dimseProxySettings;
      
      if (!proxyServer) {
        errors.push('dimseProxySettings.proxyServer is required');
      } else {
        if (!proxyServer.aet) {
          errors.push('dimseProxySettings.proxyServer.aet is required');
        }
        if (!proxyServer.ip) {
          errors.push('dimseProxySettings.proxyServer.ip is required');
        }
        if (!proxyServer.port || typeof proxyServer.port !== 'number') {
          errors.push('dimseProxySettings.proxyServer.port must be a number');
        }

        // Validate TLS security options if provided
        if (proxyServer.securityOptions) {
          const securityOptions = proxyServer.securityOptions;

          if (!securityOptions.key || typeof securityOptions.key !== 'string') {
            errors.push('dimseProxySettings.proxyServer.securityOptions.key is required and must be a string');
          }
          if (!securityOptions.cert || typeof securityOptions.cert !== 'string') {
            errors.push('dimseProxySettings.proxyServer.securityOptions.cert is required and must be a string');
          }

          // Validate certificate paths are absolute
          if (securityOptions.key && !isAbsolute(securityOptions.key)) {
            errors.push('dimseProxySettings.proxyServer.securityOptions.key must be an absolute path');
          }
          if (securityOptions.cert && !isAbsolute(securityOptions.cert)) {
            errors.push('dimseProxySettings.proxyServer.securityOptions.cert must be an absolute path');
          }
          if (securityOptions.ca && !isAbsolute(securityOptions.ca)) {
            errors.push('dimseProxySettings.proxyServer.securityOptions.ca must be an absolute path');
          }

          // Validate optional boolean fields
          if (securityOptions.requestCert !== undefined && typeof securityOptions.requestCert !== 'boolean') {
            errors.push('dimseProxySettings.proxyServer.securityOptions.requestCert must be a boolean');
          }
          if (securityOptions.rejectUnauthorized !== undefined && typeof securityOptions.rejectUnauthorized !== 'boolean') {
            errors.push('dimseProxySettings.proxyServer.securityOptions.rejectUnauthorized must be a boolean');
          }

          // Validate TLS version strings if provided
          const validTlsVersions = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
          if (securityOptions.minVersion && !validTlsVersions.includes(securityOptions.minVersion)) {
            errors.push(`dimseProxySettings.proxyServer.securityOptions.minVersion must be one of: ${validTlsVersions.join(', ')}`);
          }
          if (securityOptions.maxVersion && !validTlsVersions.includes(securityOptions.maxVersion)) {
            errors.push(`dimseProxySettings.proxyServer.securityOptions.maxVersion must be one of: ${validTlsVersions.join(', ')}`);
          }
        }

        // Check for port conflicts when using C-MOVE (requires both HTTP and DIMSE servers)
        if (!config.useCget) {
          if (config.webserverPort && proxyServer.port === config.webserverPort) {
            errors.push('dimseProxySettings.proxyServer.port cannot be the same as webserverPort when using C-MOVE');
          }
          if (config.ssl?.enabled && config.ssl?.port && proxyServer.port === config.ssl.port) {
            errors.push('dimseProxySettings.proxyServer.port cannot be the same as ssl.port when using C-MOVE');
          }
        }
      }

      if (!peers || !Array.isArray(peers) || peers.length === 0) {
        errors.push('dimseProxySettings.peers must be a non-empty array');
      } else {
        peers.forEach((peer, index) => {
          if (!peer.aet) {
            errors.push(`dimseProxySettings.peers[${index}].aet is required`);
          }
          if (!peer.ip) {
            errors.push(`dimseProxySettings.peers[${index}].ip is required`);
          }
          if (!peer.port || typeof peer.port !== 'number') {
            errors.push(`dimseProxySettings.peers[${index}].port must be a number`);
          }
        });
      }

      // Validate optional connection queue settings
      if (config.dimseProxySettings.maxConcurrentConnections !== undefined) {
        if (typeof config.dimseProxySettings.maxConcurrentConnections !== 'number' ||
            config.dimseProxySettings.maxConcurrentConnections < 1) {
          errors.push('dimseProxySettings.maxConcurrentConnections must be a positive number');
        }
      }

      if (config.dimseProxySettings.delayBetweenRequestsMs !== undefined) {
        if (typeof config.dimseProxySettings.delayBetweenRequestsMs !== 'number' ||
            config.dimseProxySettings.delayBetweenRequestsMs < 0) {
          errors.push('dimseProxySettings.delayBetweenRequestsMs must be a non-negative number');
        }
      }
    }
  }

  if (!config.webserverPort || typeof config.webserverPort !== 'number') {
    errors.push('webserverPort must be a number');
  }

  if (!config.storagePath || typeof config.storagePath !== 'string') {
    errors.push('storagePath must be a string');
  }

  if (config.cacheRetentionMinutes !== undefined && typeof config.cacheRetentionMinutes !== 'number') {
    errors.push('cacheRetentionMinutes must be a number');
  }


  if (config.ssl) {
    if (config.ssl.enabled && typeof config.ssl.enabled !== 'boolean') {
      errors.push('ssl.enabled must be a boolean');
    }
    if (config.ssl.port !== undefined && typeof config.ssl.port !== 'number') {
      errors.push('ssl.port must be a number');
    }
    if (config.ssl.certPath && typeof config.ssl.certPath !== 'string') {
      errors.push('ssl.certPath must be a string');
    }
    if (config.ssl.enabled && config.ssl.certPath && !isAbsolute(config.ssl.certPath)) {
      errors.push('ssl.certPath must be an absolute path when SSL is enabled');
    }
    if (config.ssl.keyPath && typeof config.ssl.keyPath !== 'string') {
      errors.push('ssl.keyPath must be a string');
    }
    if (config.ssl.enabled && config.ssl.keyPath && !isAbsolute(config.ssl.keyPath)) {
      errors.push('ssl.keyPath must be an absolute path when SSL is enabled');
    }
    if (config.ssl.generateSelfSigned !== undefined && typeof config.ssl.generateSelfSigned !== 'boolean') {
      errors.push('ssl.generateSelfSigned must be a boolean');
    }
    if (config.ssl.redirectHttp !== undefined && typeof config.ssl.redirectHttp !== 'boolean') {
      errors.push('ssl.redirectHttp must be a boolean');
    }
  }

  if (config.cors) {
    if (config.cors.origin && !Array.isArray(config.cors.origin)) {
      errors.push('cors.origin must be an array');
    }
    if (config.cors.methods && !Array.isArray(config.cors.methods)) {
      errors.push('cors.methods must be an array');
    }
    if (config.cors.allowedHeaders && !Array.isArray(config.cors.allowedHeaders)) {
      errors.push('cors.allowedHeaders must be an array');
    }
    if (config.cors.credentials !== undefined && typeof config.cors.credentials !== 'boolean') {
      errors.push('cors.credentials must be a boolean');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return setDefaults(config);
}

function setDefaults(config: any): ProxyConfig {
  return {
    proxyMode: config.proxyMode,
    dicomwebProxySettings: config.dicomwebProxySettings,
    dimseProxySettings: config.dimseProxySettings,
    storagePath: config.storagePath,
    cacheRetentionMinutes: config.cacheRetentionMinutes ?? 60,
    enableCache: config.enableCache ?? true,
    webserverPort: config.webserverPort,
    useCget: config.useCget ?? false,
    qidoMinChars: config.qidoMinChars ?? 0,
    qidoAppendWildcard: config.qidoAppendWildcard ?? true,
    ssl: {
      enabled: config.ssl?.enabled ?? false,
      port: config.ssl?.port ?? 443,
      certPath: config.ssl?.certPath ?? '/opt/dicomweb-proxy/certs/server.crt',
      keyPath: config.ssl?.keyPath ?? '/opt/dicomweb-proxy/certs/server.key',
      generateSelfSigned: config.ssl?.generateSelfSigned ?? false,
      redirectHttp: (config.ssl?.enabled ?? false) ? (config.ssl?.redirectHttp ?? true) : false,
    },
    cors: {
      origin: config.cors?.origin ?? ['*'],
      methods: config.cors?.methods ?? ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: config.cors?.allowedHeaders ?? ['Content-Type', 'Authorization', 'Accept'],
      credentials: config.cors?.credentials ?? true,
    },
  };
}