import { IncomingMessage, ServerResponse } from 'node:http';
import { ProxyConfig, MiddlewareFunction } from '../../types';

export class CorsMiddleware {
  private config: ProxyConfig['cors'];

  constructor(config: ProxyConfig['cors']) {
    this.config = config;
  }

  public middleware(): MiddlewareFunction {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      this.setCorsHeaders(req, res);

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      next();
    };
  }

  private setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    const allowedOrigin = this.getAllowedOrigin(origin);

    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    }

    res.setHeader('Access-Control-Allow-Methods', this.config.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', this.config.allowedHeaders.join(', '));

    if (this.config.credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private getAllowedOrigin(requestOrigin: string | undefined): string | null {
    if (!requestOrigin) {
      return this.config.origin.includes('*') ? '*' : null;
    }

    if (this.config.origin.includes('*')) {
      return requestOrigin;
    }

    for (const allowedOrigin of this.config.origin) {
      if (this.matchOrigin(requestOrigin, allowedOrigin)) {
        return requestOrigin;
      }
    }

    return null;
  }

  private matchOrigin(requestOrigin: string, allowedOrigin: string): boolean {
    if (allowedOrigin === requestOrigin) {
      return true;
    }

    if (allowedOrigin.includes('*')) {
      const pattern = allowedOrigin.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(requestOrigin);
    }

    return false;
  }

  public static create(config: ProxyConfig['cors']): CorsMiddleware {
    return new CorsMiddleware(config);
  }
}