import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { Route, RouteMatch, RequestHandler } from '../types';

export class Router {
  private routes: Route[] = [];

  public addRoute(method: string, path: string, handler: RequestHandler): void {
    const paramNames: string[] = [];
    const pathRegex = new RegExp(
      '^' + path.replace(/:[^/]+/g, (match) => {
        paramNames.push(match.substring(1));
        return '([^/]+)';
      }) + '$'
    );

    this.routes.push({
      method: method.toUpperCase(),
      path,
      handler,
      pathRegex,
      paramNames,
    });
  }

  public get(path: string, handler: RequestHandler): void {
    this.addRoute('GET', path, handler);
  }

  public post(path: string, handler: RequestHandler): void {
    this.addRoute('POST', path, handler);
  }

  public put(path: string, handler: RequestHandler): void {
    this.addRoute('PUT', path, handler);
  }

  public delete(path: string, handler: RequestHandler): void {
    this.addRoute('DELETE', path, handler);
  }

  public options(path: string, handler: RequestHandler): void {
    this.addRoute('OPTIONS', path, handler);
  }

  public all(path: string, handler: RequestHandler): void {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'];
    methods.forEach(method => this.addRoute(method, path, handler));
  }

  public findRoute(method: string, path: string): RouteMatch | null {
    const upperMethod = method.toUpperCase();
    
    for (const route of this.routes) {
      if (route.method === upperMethod || route.method === 'ALL') {
        const match = path.match(route.pathRegex);
        if (match) {
          const params: Record<string, string> = {};
          
          route.paramNames.forEach((paramName, index) => {
            params[paramName] = match[index + 1] || '';
          });

          return {
            handler: route.handler,
            params,
          };
        }
      }
    }

    return null;
  }

  public handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';
    const path = url.pathname;

    const match = this.findRoute(method, path);
    
    if (match) {
      (req as any).params = match.params;
      return match.handler(req, res);
    }

    this.send404(res);
    return Promise.resolve();
  }

  private send404(res: ServerResponse): void {
    const errorResponse = {
      error: 'Not Found',
      statusCode: 404,
      timestamp: new Date().toISOString()
    };
    
    const jsonResponse = JSON.stringify(errorResponse);
    
    res.writeHead(404, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(jsonResponse),
    });
    
    res.end(jsonResponse);
  }

  public getRoutes(): Route[] {
    return [...this.routes];
  }

  public removeRoute(method: string, path: string): boolean {
    const upperMethod = method.toUpperCase();
    const initialLength = this.routes.length;
    
    this.routes = this.routes.filter(route => 
      !(route.method === upperMethod && route.path === path)
    );
    
    return this.routes.length < initialLength;
  }

  public clear(): void {
    this.routes = [];
  }

  public use(middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void {
    const originalHandle = this.handle.bind(this);
    
    this.handle = (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      return new Promise((resolve, reject) => {
        middleware(req, res, async () => {
          try {
            await originalHandle(req, res);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    };
  }

  public static createQidoRoutes(): string[] {
    return [
      '/studies',
      '/studies/:studyInstanceUID/series',
      '/studies/:studyInstanceUID/series/:seriesInstanceUID/instances',
    ];
  }

  public static createWadoRoutes(): string[] {
    return [
      '/studies/:studyInstanceUID',
      '/studies/:studyInstanceUID/series/:seriesInstanceUID',
      '/studies/:studyInstanceUID/series/:seriesInstanceUID/instances/:sopInstanceUID',
    ];
  }

  public static createHealthRoutes(): string[] {
    return [
      '/health',
      '/status',
      '/ping',
    ];
  }
}