import {
  createServer as createHttpServer,
  Server as HttpServer,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import {
  createServer as createHttpsServer,
  Server as HttpsServer,
} from "node:https";
import { ProxyConfig, RequestHandler } from "../types";
import { SslManager } from "./middleware/ssl";

export class ProxyServer {
  private httpServer: HttpServer | null = null;
  private httpsServer: HttpsServer | null = null;
  private config: ProxyConfig;
  private requestHandler: RequestHandler;

  constructor(config: ProxyConfig, requestHandler: RequestHandler) {
    this.config = config;
    this.requestHandler = requestHandler;
  }

  public async start(): Promise<void> {
    await this.startHttpServer();

    if (this.config.ssl.enabled) {
      await this.startHttpsServer();
    }
  }

  private async startHttpServer(): Promise<void> {
    this.httpServer = createHttpServer((req, res) => {
      if (this.config.ssl.enabled && this.config.ssl.redirectHttp) {
        this.redirectToHttps(req, res);
      } else {
        this.handleRequest(req, res);
      }
    });

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(this.config.webserverPort, () => {
        console.log(
          `HTTP server listening on port ${this.config.webserverPort}`
        );
        resolve();
      });

      this.httpServer!.on("error", (error) => {
        console.error("HTTP server error:", error);
        reject(error);
      });
    });
  }

  private async startHttpsServer(): Promise<void> {
    const sslManager = new SslManager(this.config.ssl);
    const sslOptions = sslManager.getSslOptions();

    if (!sslOptions) {
      throw new Error("SSL is enabled but no SSL options available");
    }

    this.httpsServer = createHttpsServer(sslOptions, (req, res) => {
      this.handleRequest(req, res);
    });

    // Add SSL-specific error handling
    this.httpsServer.on('clientError', (err, socket) => {
      console.error('HTTPS client error:', err.message);
      if (socket.writable) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    });

    this.httpsServer.on('secureConnection', (tlsSocket) => {
      console.log('SSL Debug: Secure connection established');
      console.log(`SSL Debug: Protocol: ${tlsSocket.getProtocol()}`);
      console.log(`SSL Debug: Cipher: ${tlsSocket.getCipher()?.name || 'unknown'}`);
    });

    return new Promise((resolve, reject) => {
      this.httpsServer!.listen(this.config.ssl.port, () => {
        console.log(`HTTPS server listening on port ${this.config.ssl.port}`);
        console.log(`SSL Debug: Access via https://localhost:${this.config.ssl.port}`);
        resolve();
      });

      this.httpsServer!.on("error", (error) => {
        console.error("HTTPS server error:", error);
        reject(error);
      });
    });
  }

  private redirectToHttps(req: IncomingMessage, res: ServerResponse): void {
    const host = req.headers.host;
    if (!host) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request: Host header required");
      return;
    }

    const httpsPort =
      this.config.ssl.port === 443 ? "" : `:${this.config.ssl.port}`;
    const redirectUrl = `https://${host.split(":")[0]}${httpsPort}${req.url}`;

    res.writeHead(301, {
      Location: redirectUrl,
      "Content-Type": "text/plain",
    });
    res.end(`Redirecting to ${redirectUrl}`);
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    try {
      await this.requestHandler(req, res);
    } catch (error) {
      console.error("Request handler error:", error);
      this.sendErrorResponse(res, 500, "Internal Server Error");
    }
  }

  private sendErrorResponse(
    res: ServerResponse,
    statusCode: number,
    message: string
  ): void {
    if (res.headersSent) {
      return;
    }

    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    });

    res.end(
      JSON.stringify({
        error: message,
        statusCode,
        timestamp: new Date().toISOString(),
      })
    );
  }

  public async stop(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.httpServer) {
      promises.push(
        new Promise((resolve) => {
          this.httpServer!.close(() => {
            console.log("HTTP server stopped");
            resolve();
          });
          this.httpServer!.closeAllConnections();
        })
      );
    }

    if (this.httpsServer) {
      promises.push(
        new Promise((resolve) => {
          this.httpsServer!.close(() => {
            console.log("HTTPS server stopped");
            resolve();
          });
          this.httpsServer!.closeAllConnections();
        })
      );
    }

    await Promise.all(promises);
  }

  public getHttpServer(): HttpServer | null {
    return this.httpServer;
  }

  public getHttpsServer(): HttpsServer | null {
    return this.httpsServer;
  }

  public isRunning(): boolean {
    return (
      (this.httpServer && this.httpServer.listening) ||
      (this.httpsServer && this.httpsServer.listening) ||
      false
    );
  }
}
