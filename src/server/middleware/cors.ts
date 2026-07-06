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
      // When echoing a specific origin the response varies by request origin.
      if (allowedOrigin !== '*') {
        res.setHeader('Vary', 'Origin');
      }
    }

    res.setHeader('Access-Control-Allow-Methods', this.config.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', this.config.allowedHeaders.join(', '));

    // Only advertise credentials support for an explicit, matched origin.
    // Combining Access-Control-Allow-Credentials:true with a wildcard/reflected
    // origin is the classic CSRF-enabling CORS misconfiguration, so never do it
    // when the allowed origin is the literal '*'.
    if (this.config.credentials && allowedOrigin && allowedOrigin !== '*') {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private getAllowedOrigin(requestOrigin: string | undefined): string | null {
    // A wildcard configuration returns the literal '*' — never the reflected
    // request origin — so it can't be paired with credentialed requests.
    if (this.config.origin.includes('*')) {
      return '*';
    }

    if (!requestOrigin) {
      return null;
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