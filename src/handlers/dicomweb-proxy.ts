import { IncomingMessage, ServerResponse } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';
import { ProxyConfig, RequestHandler } from '../types';
import { sendError } from '../utils/http-response';

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
        sendError(res, 502, 'Bad Gateway');
      });

      proxyReq.on('timeout', () => {
        console.error('Proxy request timeout');
        sendError(res, 504, 'Gateway Timeout');
      });

      req.pipe(proxyReq);
      
    } catch (error) {
      console.error('Forward request error:', error);
      sendError(res, 500, 'Internal Server Error');
    }
  }

}