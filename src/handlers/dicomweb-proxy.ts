import { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { ProxyConfig, RequestHandler } from '../types';

export class DicomWebProxyHandler {
  private config: ProxyConfig;

  constructor(config: ProxyConfig) {
    this.config = config;
    
    if (config.proxyMode !== 'dicomweb' || !config.dicomwebProxySettings) {
      throw new Error('DicomWeb proxy handler requires dicomweb proxy mode');
    }
  }

  public getQidoHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      const forwardingUrl = this.config.dicomwebProxySettings!.qidoForwardingUrl;
      await this.forwardRequest(req, res, forwardingUrl);
    };
  }

  public getWadoHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      const forwardingUrl = this.config.dicomwebProxySettings!.wadoForwardingUrl;
      await this.forwardRequest(req, res, forwardingUrl);
    };
  }

  private async forwardRequest(req: IncomingMessage, res: ServerResponse, baseUrl: string): Promise<void> {
    try {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const targetUrl = new URL(url.pathname + url.search, baseUrl);
      
      const isHttps = targetUrl.protocol === 'https:';
      const requestFunc = isHttps ? httpsRequest : httpRequest;
      
      const requestOptions = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: { ...req.headers },
      };

      delete requestOptions.headers.host;

      const proxyReq = requestFunc(requestOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (error) => {
        console.error('Proxy request error:', error);
        this.sendError(res, 502, 'Bad Gateway');
      });

      proxyReq.on('timeout', () => {
        console.error('Proxy request timeout');
        this.sendError(res, 504, 'Gateway Timeout');
      });

      req.pipe(proxyReq);
      
    } catch (error) {
      console.error('Forward request error:', error);
      this.sendError(res, 500, 'Internal Server Error');
    }
  }

  private sendError(res: ServerResponse, statusCode: number, message: string): void {
    if (res.headersSent) {
      return;
    }

    const errorResponse = {
      error: message,
      statusCode,
      timestamp: new Date().toISOString()
    };
    
    const jsonResponse = JSON.stringify(errorResponse);
    
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(jsonResponse),
    });
    
    res.end(jsonResponse);
  }
}