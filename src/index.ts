#!/usr/bin/env node

import { IncomingMessage, ServerResponse } from "http";
import { ConfigManager } from "./config/config";
import { ProxyServer } from "./server/http-server";
import { Router } from "./server/router";
import { CorsMiddleware } from "./server/middleware/cors";
import { QidoHandler } from "./handlers/qido";
import { WadoHandler } from "./handlers/wado";
import { DicomWebProxyHandler } from "./handlers/dicomweb-proxy";
import { DimseClient } from "./dimse/client";
import { FileCache } from "./cache/file-cache";
import { CacheCleanupService } from "./cache/cleanup";
import { ProxyConfig } from "./types";

class DicomWebProxy {
  private config: ProxyConfig;
  private server: ProxyServer;
  private router: Router;
  private cache: FileCache | null = null;
  private cleanupService: CacheCleanupService | null = null;

  constructor(configPath?: string) {
    try {
      const configManager = new ConfigManager(configPath);
      this.config = configManager.getConfig();

      console.log(
        `Configuration loaded from: ${configManager.getConfigPath()}`
      );
      console.log(`Proxy mode: ${this.config.proxyMode}`);

      if (this.config.proxyMode === "dimse" && this.config.enableCache) {
        this.initializeCache();
      }

      this.router = new Router();
      this.setupRoutes();

      const corsMiddleware = CorsMiddleware.create(this.config.cors);
      this.router.use(corsMiddleware.middleware());

      this.server = new ProxyServer(
        this.config,
        this.router.handle.bind(this.router)
      );
    } catch (error) {
      console.error("Failed to initialize proxy:", error);
      process.exit(1);
    }
  }

  private initializeCache(): void {
    this.cache = new FileCache(
      this.config.storagePath,
      this.config.cacheRetentionMinutes,
      10 * 1024 * 1024 * 1024 // 10GB default max size
    );

    this.cleanupService = new CacheCleanupService(this.cache, 15);
  }

  private setupRoutes(): void {
    this.setupHealthRoutes();

    if (this.config.proxyMode === "dimse") {
      this.setupDimseRoutes();
    } else {
      this.setupDicomWebProxyRoutes();
    }
  }

  private setupHealthRoutes(): void {
    // Root path - HTML status dashboard
    this.router.get("/", async (_req: IncomingMessage, res: ServerResponse) => {
      const healthInfo = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: process.env["npm_package_version"] || "1.0.0",
        proxyMode: this.config.proxyMode,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cache:
          this.cache && this.config.enableCache
            ? this.cache.getStats()
            : { enabled: false },
      };

      const formatBytes = (bytes: number): string => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
      };

      const formatUptime = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (days > 0) {
          return `${days}d ${hours}h ${minutes}m ${secs}s`;
        } else if (hours > 0) {
          return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
          return `${minutes}m ${secs}s`;
        } else {
          return `${secs}s`;
        }
      };

      const memUsagePercent = (
        (healthInfo.memory.heapUsed / healthInfo.memory.heapTotal) *
        100
      ).toFixed(1);
      const cacheEnabled =
        healthInfo.cache && (healthInfo.cache as any).enabled !== false;

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pacsbin DICOM Web Proxy - Status Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { font-size: 2.5rem; margin-bottom: 10px; font-weight: 300; }
        .header p { font-size: 1.1rem; opacity: 0.9; }
        .content { padding: 30px; }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .status-card { background: #f8f9fa; border-radius: 8px; padding: 20px; border-left: 4px solid #28a745; }
        .status-card h3 { color: #2c3e50; margin-bottom: 15px; font-size: 1.2rem; }
        .status-item { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
        .status-item:last-child { border-bottom: none; margin-bottom: 0; }
        .status-label { font-weight: 500; color: #495057; }
        .status-value { color: #2c3e50; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; }
        .status-indicator { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; background-color: #28a745; }
        .memory-bar { width: 100%; height: 8px; background-color: #e9ecef; border-radius: 4px; overflow: hidden; margin-top: 5px; }
        .memory-fill { height: 100%; background: linear-gradient(90deg, #28a745, #ffc107, #dc3545); width: ${memUsagePercent}%; }
        .endpoints { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-top: 20px; }
        .endpoints h3 { color: #2c3e50; margin-bottom: 15px; }
        .endpoint-link { display: inline-block; background: #007bff; color: white; text-decoration: none; padding: 8px 16px; border-radius: 4px; margin: 5px 5px 5px 0; font-size: 0.9rem; }
        .endpoint-link:hover { background: #0056b3; }
        .refresh-btn { background: linear-gradient(135deg, #3498db 0%, #2c3e50 100%); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem; display: block; margin: 20px auto 0; }
        .refresh-btn:hover { transform: translateY(-2px); }
        .peer-card { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 15px; margin: 10px 0; }
        .peer-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .peer-title { font-weight: 600; color: #495057; }
        .echo-btn { background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
        .echo-btn:hover { background: #218838; }
        .echo-btn:disabled { background: #6c757d; cursor: not-allowed; }
        .echo-result { margin-top: 8px; padding: 8px; border-radius: 4px; font-size: 0.9rem; }
        .echo-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .echo-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .echo-testing { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
        @media (max-width: 768px) { .status-grid { grid-template-columns: 1fr; } .header h1 { font-size: 2rem; } .content { padding: 20px; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DICOM Web Proxy</h1>
            <p>Status Dashboard & Health Monitor</p>
        </div>
        
        <div class="content">
            <div class="status-grid">
                <div class="status-card">
                    <h3><span class="status-indicator"></span>General Status</h3>
                    <div class="status-item"><span class="status-label">Status:</span><span class="status-value">${
                      healthInfo.status
                    }</span></div>
                    <div class="status-item"><span class="status-label">Version:</span><span class="status-value">${
                      healthInfo.version
                    }</span></div>
                    <div class="status-item"><span class="status-label">Proxy Mode:</span><span class="status-value">${
                      healthInfo.proxyMode
                    }</span></div>
                    <div class="status-item"><span class="status-label">Last Updated:</span><span class="status-value">${new Date(
                      healthInfo.timestamp
                    ).toLocaleString()}</span></div>
                </div>
                
                <div class="status-card">
                    <h3>System Information</h3>
                    <div class="status-item"><span class="status-label">Uptime:</span><span class="status-value">${formatUptime(
                      healthInfo.uptime
                    )}</span></div>
                    <div class="status-item"><span class="status-label">Web Server:</span><span class="status-value">Port ${
                      this.config.webserverPort
                    }</span></div>
                    <div class="status-item"><span class="status-label">SSL:</span><span class="status-value">${
                      this.config.ssl.enabled
                        ? `Enabled (Port ${this.config.ssl.port})`
                        : "Disabled"
                    }</span></div>
                    <div class="status-item"><span class="status-label">Cache:</span><span class="status-value">${
                      this.config.enableCache ? "Enabled" : "Disabled"
                    }</span></div>
                </div>
                
                <div class="status-card">
                    <h3>Memory Usage</h3>
                    <div class="status-item"><span class="status-label">Heap Used:</span><span class="status-value">${formatBytes(
                      healthInfo.memory.heapUsed
                    )}</span></div>
                    <div class="status-item"><span class="status-label">Heap Total:</span><span class="status-value">${formatBytes(
                      healthInfo.memory.heapTotal
                    )}</span></div>
                    <div class="status-item"><span class="status-label">RSS:</span><span class="status-value">${formatBytes(
                      healthInfo.memory.rss
                    )}</span></div>
                    <!--<div class="status-item"><span class="status-label">Usage:</span><span class="status-value">${memUsagePercent}%</span></div>-->
                    <div class="memory-bar"><div class="memory-fill"></div></div>
                </div>
                
                <div class="status-card">
                    <h3>Cache Status</h3>
                    ${
                      cacheEnabled
                        ? `
                    <div class="status-item"><span class="status-label">Total Size:</span><span class="status-value">${formatBytes(
                      (healthInfo.cache as any).totalSize || 0
                    )}</span></div>
                    <div class="status-item"><span class="status-label">Entry Count:</span><span class="status-value">${
                      (healthInfo.cache as any).entryCount || 0
                    }</span></div>
                    <div class="status-item"><span class="status-label">Hit Rate:</span><span class="status-value">${(
                      ((healthInfo.cache as any).hitRate || 0) * 100
                    ).toFixed(1)}%</span></div>
                    `
                        : `
                    <div class="status-item"><span class="status-label">Status:</span><span class="status-value">Disabled</span></div>
                    `
                    }
                </div>
            </div>
            
            ${
              this.config.proxyMode === "dimse" &&
              this.config.dimseProxySettings
                ? `
            <div class="endpoints">
                <h3>DIMSE Configuration</h3>
                <div class="status-item">
                    <span class="status-label">Proxy AET:</span>
                    <span class="status-value">${
                      this.config.dimseProxySettings.proxyServer.aet
                    }</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Proxy Port:</span>
                    <span class="status-value">${
                      this.config.dimseProxySettings.proxyServer.port
                    }</span>
                </div>
                
                <h4 style="margin: 15px 0 10px 0; color: #495057;">PACS Peers (${
                  this.config.dimseProxySettings.peers.length
                })</h4>
                ${this.config.dimseProxySettings.peers
                  .map(
                    (peer, index) => `
                <div class="peer-card">
                    <div class="peer-header">
                        <span class="peer-title">${peer.aet}</span>
                        <button class="echo-btn" onclick="testEcho(${index})">C-ECHO Test</button>
                    </div>
                    <div class="status-item">
                        <span class="status-label">Host:</span>
                        <span class="status-value">${peer.ip}:${peer.port}</span>
                    </div>
                    <div id="echo-result-${index}"></div>
                </div>
                `
                  )
                  .join("")}
            </div>
            `
                : ""
            }
            
            <div class="endpoints">
                <h3>API Endpoints</h3>
                <!--<a href="/health" class="endpoint-link" target="_blank">/health</a>-->
                <a href="/status" class="endpoint-link" target="_blank">/status</a>
                <a href="/ping" class="endpoint-link" target="_blank">/ping</a>
            </div>
            
            <button class="refresh-btn" onclick="window.location.reload()">Refresh Status</button>
        </div>
    </div>

    <script>
        async function testEcho(peerIndex) {
            const resultDiv = document.getElementById('echo-result-' + peerIndex);
            const btn = event.target;
            
            // Disable button and show testing state
            btn.disabled = true;
            btn.textContent = 'Testing...';
            resultDiv.innerHTML = '<div class="echo-result echo-testing">Testing C-ECHO connection...</div>';
            
            try {
                const response = await fetch('/dimse/echo', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ peerIndex: peerIndex })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultDiv.innerHTML = \`
                        <div class="echo-result echo-success">
                            ✓ C-ECHO successful (\${result.responseTime}ms)
                        </div>
                    \`;
                } else {
                    resultDiv.innerHTML = \`
                        <div class="echo-result echo-error">
                            ✗ C-ECHO failed: \${result.error} (\${result.responseTime}ms)
                        </div>
                    \`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`
                    <div class="echo-result echo-error">
                        ✗ Connection error: \${error.message}
                    </div>
                \`;
            } finally {
                // Re-enable button
                btn.disabled = false;
                btn.textContent = 'C-ECHO Test';
            }
        }
    </script>
</body>
</html>`;

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    });

    const healthHandler = async (
      _req: IncomingMessage,
      res: ServerResponse
    ) => {
      const healthInfo = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: process.env["npm_package_version"] || "1.0.0",
        proxyMode: this.config.proxyMode,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cache:
          this.cache && this.config.enableCache
            ? this.cache.getStats()
            : { enabled: false },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(healthInfo, null, 2));
    };

    this.router.get("/health", healthHandler);
    this.router.get("/status", healthHandler);
    this.router.get("/ping", async (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("pong");
    });

    // C-ECHO connectivity test endpoint (only for DIMSE mode)
    if (this.config.proxyMode === "dimse" && this.config.dimseProxySettings) {
      this.router.post("/dimse/echo", async (req, res) => {
        try {
          const body = await this.parseRequestBody(req);
          const { peerIndex } = JSON.parse(body);

          if (
            typeof peerIndex !== "number" ||
            peerIndex < 0 ||
            peerIndex >= this.config.dimseProxySettings!.peers.length
          ) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid peer index" }));
            return;
          }

          const peer = this.config.dimseProxySettings!.peers[peerIndex];
          const dimseClient = new DimseClient(this.config.dimseProxySettings!);
          const startTime = Date.now();

          try {
            const success = await dimseClient.echo(peer);
            const responseTime = Date.now() - startTime;

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: success,
                peer: peer,
                responseTime: responseTime,
                message: success ? "C-ECHO successful" : "C-ECHO failed",
              })
            );
          } catch (error) {
            const responseTime = Date.now() - startTime;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                peer: peer,
                responseTime: responseTime,
                error: (error as Error).message,
              })
            );
          }
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    }
  }

  private parseRequestBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        resolve(body);
      });
      req.on("error", reject);
    });
  }

  private setupDimseRoutes(): void {
    const qidoHandler = new QidoHandler(this.config);
    const wadoHandler = new WadoHandler(this.config, this.cache);

    this.router.get("/studies", qidoHandler.getHandler());
    this.router.get(
      "/studies/:studyInstanceUID/series",
      qidoHandler.getHandler()
    );
    this.router.get(
      "/studies/:studyInstanceUID/series/:seriesInstanceUID/instances",
      qidoHandler.getHandler()
    );

    this.router.get("/studies/:studyInstanceUID", wadoHandler.getHandler());
    this.router.get(
      "/studies/:studyInstanceUID/series/:seriesInstanceUID",
      wadoHandler.getHandler()
    );
    this.router.get(
      "/studies/:studyInstanceUID/series/:seriesInstanceUID/instances/:sopInstanceUID",
      wadoHandler.getHandler()
    );
  }

  private setupDicomWebProxyRoutes(): void {
    const proxyHandler = new DicomWebProxyHandler(this.config);

    const qidoHandler = proxyHandler.getQidoHandler();
    const wadoHandler = proxyHandler.getWadoHandler();

    this.router.get("/studies", qidoHandler);
    this.router.get("/studies/:studyInstanceUID/series", qidoHandler);
    this.router.get(
      "/studies/:studyInstanceUID/series/:seriesInstanceUID/instances",
      qidoHandler
    );

    this.router.get("/studies/:studyInstanceUID", wadoHandler);
    this.router.get(
      "/studies/:studyInstanceUID/series/:seriesInstanceUID",
      wadoHandler
    );
    this.router.get(
      "/studies/:studyInstanceUID/series/:seriesInstanceUID/instances/:sopInstanceUID",
      wadoHandler
    );
  }

  public async start(): Promise<void> {
    try {
      await this.server.start();

      if (this.cleanupService) {
        this.cleanupService.start();
      }

      console.log("DICOM Web Proxy started successfully");
      console.log(`HTTP server: http://localhost:${this.config.webserverPort}`);

      if (this.config.ssl.enabled) {
        console.log(`HTTPS server: https://localhost:${this.config.ssl.port}`);
      }
    } catch (error) {
      console.error("Failed to start proxy:", error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    try {
      if (this.cleanupService) {
        this.cleanupService.stop();
      }

      await this.server.stop();
      console.log("DICOM Web Proxy stopped");
    } catch (error) {
      console.error("Error stopping proxy:", error);
    }
  }

  public getConfig(): ProxyConfig {
    return this.config;
  }

  public getCache(): FileCache | null {
    return this.cache;
  }
}

async function main(): Promise<void> {
  const configPath = process.argv[2];
  const proxy = new DicomWebProxy(configPath);

  process.on("SIGINT", async () => {
    console.log("\\nReceived SIGINT, shutting down gracefully...");
    await proxy.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\\nReceived SIGTERM, shutting down gracefully...");
    await proxy.stop();
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled rejection at:", promise, "reason:", reason);
    process.exit(1);
  });

  await proxy.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to start application:", error);
    process.exit(1);
  });
}

export { DicomWebProxy };
export default DicomWebProxy;
