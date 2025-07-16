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
    }
  }

  if (!config.webserverPort || typeof config.webserverPort !== 'number') {
    errors.push('webserverPort must be a number');
  }

  if (!config.logDir || typeof config.logDir !== 'string') {
    errors.push('logDir must be a string');
  }

  if (!config.storagePath || typeof config.storagePath !== 'string') {
    errors.push('storagePath must be a string');
  }

  if (config.cacheRetentionMinutes !== undefined && typeof config.cacheRetentionMinutes !== 'number') {
    errors.push('cacheRetentionMinutes must be a number');
  }

  if (config.maxAssociations !== undefined && typeof config.maxAssociations !== 'number') {
    errors.push('maxAssociations must be a number');
  }

  if (config.useFetchLevel && !['PATIENT', 'STUDY', 'SERIES', 'INSTANCE'].includes(config.useFetchLevel)) {
    errors.push('useFetchLevel must be one of: PATIENT, STUDY, SERIES, INSTANCE');
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
    if (config.ssl.certPath && !isAbsolute(config.ssl.certPath)) {
      errors.push('ssl.certPath must be an absolute path');
    }
    if (config.ssl.keyPath && typeof config.ssl.keyPath !== 'string') {
      errors.push('ssl.keyPath must be a string');
    }
    if (config.ssl.keyPath && !isAbsolute(config.ssl.keyPath)) {
      errors.push('ssl.keyPath must be an absolute path');
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
    logDir: config.logDir,
    storagePath: config.storagePath,
    cacheRetentionMinutes: config.cacheRetentionMinutes ?? 60,
    enableCache: config.enableCache ?? true,
    webserverPort: config.webserverPort,
    useCget: config.useCget ?? false,
    useFetchLevel: config.useFetchLevel ?? 'SERIES',
    maxAssociations: config.maxAssociations ?? 4,
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