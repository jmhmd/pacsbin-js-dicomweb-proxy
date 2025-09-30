#!/usr/bin/env node

import { IncomingMessage, ServerResponse } from "node:http";
import { ConfigManager } from "./config/config";
import { ProxyServer } from "./server/http-server";
import { Router } from "./server/router";
import { CorsMiddleware } from "./server/middleware/cors";
import { AuthManager, AuthMiddleware } from "./server/middleware/auth";
import { RestartManager } from "./server/restart-manager";
import { QidoHandler } from "./handlers/qido";
import { WadoHandler } from "./handlers/wado";
import { DicomWebProxyHandler } from "./handlers/dicomweb-proxy";
import { ConfigHandler } from "./handlers/config";
import { DimseClient } from "./dimse/client";
import { DimseScpServer } from "./dimse/scp-server";
import { FileCache } from "./cache/file-cache";
import { CacheCleanupService } from "./cache/cleanup";
import { ProxyConfig } from "./types";
import { generateDashboardHTML, DashboardData } from "./server/dashboard";
import { logger } from "./utils/logger";

class DicomWebProxy {
  private config: ProxyConfig;
  private configManager: ConfigManager;
  private server: ProxyServer;
  private router: Router;
  private cache: FileCache | null = null;
  private cleanupService: CacheCleanupService | null = null;
  private dimseScpServer: DimseScpServer | null = null;
  private authManager: AuthManager;
  private authMiddleware: AuthMiddleware;
  private restartManager: RestartManager;
  private configHandler: ConfigHandler;

  constructor(configPath?: string) {
    try {
      this.configManager = new ConfigManager(configPath);
      this.config = this.configManager.getConfig();

      // Initialize logger early
      logger.info("Starting DICOM Web Proxy", {
        configPath: this.configManager.getConfigPath(),
        proxyMode: this.config.proxyMode,
        version: process.env["npm_package_version"] || "unknown version",
      });

      // Initialize auth system
      const authConfig: any = {
        enabled: this.config.configAuth?.enabled ?? false,
        sessionTimeout: this.config.configAuth?.sessionTimeout ?? 30,
      };
      if (this.config.configAuth?.adminToken) {
        authConfig.adminToken = this.config.configAuth.adminToken;
      }
      this.authManager = new AuthManager(authConfig);
      this.authMiddleware = new AuthMiddleware(this.authManager);

      // Initialize restart manager
      this.restartManager = new RestartManager();

      // Initialize config handler
      this.configHandler = new ConfigHandler(
        this.configManager,
        this.restartManager
      );

      if (this.config.proxyMode === "dimse" && this.config.enableCache) {
        this.initializeCache();
      }

      if (this.config.proxyMode === "dimse" && !this.config.useCget) {
        this.initializeDimseScpServer();
      }

      this.router = new Router();
      this.setupRoutes();

      const corsMiddleware = CorsMiddleware.create(this.config.cors);
      this.router.use(corsMiddleware.middleware());

      // Add auth middleware
      this.router.use(this.authMiddleware.requireAuth());

      this.server = new ProxyServer(
        this.config,
        this.router.handle.bind(this.router)
      );
    } catch (error) {
      logger.fatal(
        "Failed to initialize proxy",
        error instanceof Error ? error : new Error(String(error))
      );
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

  private initializeDimseScpServer(): void {
    if (!this.config.dimseProxySettings) {
      throw new Error("DIMSE proxy settings required for SCP server");
    }

    this.dimseScpServer = new DimseScpServer(this.config.dimseProxySettings);
    logger.info(
      `DIMSE SCP Server initialized for C-MOVE operations on port ${this.config.dimseProxySettings.proxyServer.port}`
    );
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
    // Root path - HTML dashboard
    this.router.get("/", async (_req: IncomingMessage, res: ServerResponse) => {
      const dashboardData: DashboardData = {
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
        dimseScpServer: this.dimseScpServer
          ? this.dimseScpServer.getStats()
          : null,
        config: this.config,
        authEnabled: this.config.configAuth?.enabled ?? false,
      };

      const html = generateDashboardHTML(dashboardData);

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

    // Logging endpoints
    this.router.get("/logs/stream", this.getLogStreamHandler());
    this.router.get("/logs/download", this.getLogDownloadHandler());

    // Configuration management endpoints
    this.router.post("/config/login", this.authMiddleware.getLoginHandler());
    this.router.post("/config/logout", this.authMiddleware.getLogoutHandler());
    this.router.get(
      "/config/current",
      this.configHandler.getCurrentConfigHandler()
    );
    this.router.post("/config/test", this.configHandler.getTestConfigHandler());
    this.router.post(
      "/config/update",
      this.configHandler.getUpdateConfigHandler()
    );
    this.router.post("/config/restart", this.configHandler.getRestartHandler());
    this.router.post(
      "/config/upload-cert",
      this.configHandler.getUploadCertHandler()
    );
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

  private getLogStreamHandler() {
    return async (req: IncomingMessage, res: ServerResponse) => {
      // Check authentication
      if (!this.authMiddleware.isAuthenticated(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Authentication required for log access" })
        );
        return;
      }

      try {
        // Set SSE headers
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Cache-Control",
        });

        // Send initial logs
        const transport = logger.getDashboardTransport();
        const initialLogs = transport.getRecentLogs(50);

        for (const log of initialLogs) {
          res.write(
            `data: ${JSON.stringify({ type: "log", payload: log })}\n\n`
          );
        }

        // Throttle logs with batching
        let logBatch: any[] = [];
        const batchInterval = 100; // ms

        const flushBatch = () => {
          if (logBatch.length > 0) {
            for (const log of logBatch) {
              res.write(
                `data: ${JSON.stringify({ type: "log", payload: log })}\n\n`
              );
            }
            logBatch = [];
          }
        };

        const batchTimer = setInterval(flushBatch, batchInterval);

        // Listen for new logs
        const unsubscribe = transport.onLog((log) => {
          logBatch.push(log);
        });

        // Keep connection alive with periodic pings
        const pingInterval = setInterval(() => {
          res.write(`: ping\n\n`);
        }, 30000);

        // Handle client disconnect
        req.on("close", () => {
          clearInterval(batchTimer);
          clearInterval(pingInterval);
          flushBatch();
          unsubscribe();
        });

        req.on("error", () => {
          clearInterval(batchTimer);
          clearInterval(pingInterval);
          unsubscribe();
        });
      } catch (error) {
        logger.error(
          "Log stream error",
          error instanceof Error ? error : new Error(String(error))
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    };
  }

  private getLogDownloadHandler() {
    return async (req: IncomingMessage, res: ServerResponse) => {
      // Check authentication
      if (!this.authMiddleware.isAuthenticated(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Authentication required for log access" })
        );
        return;
      }

      try {
        const url = new URL(
          req.url || "",
          `http://${req.headers.host || "localhost"}`
        );
        const lines = Math.min(
          parseInt(url.searchParams.get("lines") || "1000"),
          10000
        );
        const format = (url.searchParams.get("format") || "text") as
          | "json"
          | "text";

        const transport = logger.getDashboardTransport();
        const logs = transport.getAllLogs(undefined, lines);

        const content = transport.formatLogsForDownload(logs, format);

        // Check size limit (10MB)
        const maxSize = 10 * 1024 * 1024;
        if (Buffer.byteLength(content) > maxSize) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error:
                "Log data too large. Try reducing lines or adding filters.",
            })
          );
          return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `dicomweb-proxy-logs-${timestamp}.${format}`;

        res.writeHead(200, {
          "Content-Type": format === "json" ? "application/json" : "text/plain",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Length": Buffer.byteLength(content),
        });

        res.end(content);
      } catch (error) {
        logger.error(
          "Log download error",
          error instanceof Error ? error : new Error(String(error))
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    };
  }


  private setupDimseRoutes(): void {
    const requestTracker = this.dimseScpServer?.getRequestTracker();
    const qidoHandler = new QidoHandler(this.config, requestTracker);
    const wadoHandler = new WadoHandler(
      this.config,
      this.cache,
      requestTracker
    );

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
      logger.info("Starting DICOM Web Proxy services");

      // Start DIMSE SCP server first if needed
      if (this.dimseScpServer) {
        logger.debug("Starting DIMSE SCP server");
        await this.dimseScpServer.start();
        logger.info("DIMSE SCP server started successfully");
      }

      logger.debug("Starting HTTP server");
      await this.server.start();
      logger.info("HTTP server started successfully");

      if (this.cleanupService) {
        this.cleanupService.start();
        logger.info("Cache cleanup service started");
      }

      logger.info("DICOM Web Proxy started successfully", {
        httpPort: this.config.webserverPort,
        httpsEnabled: this.config.ssl.enabled,
        httpsPort: this.config.ssl.enabled ? this.config.ssl.port : undefined,
        dimseEnabled: !!this.dimseScpServer,
      });

      if (this.dimseScpServer) {
        const stats = this.dimseScpServer.getStats();
        logger.info("DIMSE SCP server running", {
          aet: stats.aet,
          port: stats.port,
          mode: "C-MOVE listener",
        });
      }
    } catch (error) {
      logger.fatal(
        "Failed to start proxy",
        error instanceof Error ? error : new Error(String(error))
      );
      console.error("Failed to start proxy:", error);
      process.exit(1);
    }
  }

  public async stop(): Promise<void> {
    try {
      logger.info("Stopping DICOM Web Proxy services");

      if (this.cleanupService) {
        this.cleanupService.stop();
        logger.debug("Cache cleanup service stopped");
      }

      if (this.dimseScpServer) {
        await this.dimseScpServer.stop();
        logger.info("DIMSE SCP server stopped");
      }

      await this.server.stop();
      logger.info("HTTP server stopped");
    } catch (error) {
      logger.error(
        "Error stopping proxy",
        error instanceof Error ? error : new Error(String(error))
      );
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
  const args = process.argv.slice(2);
  const firstArg = args[0];

  // Check if this is an installer command
  const installerCommands = ["install-rhel", "test-install", "uninstall-rhel"];

  if (firstArg && installerCommands.includes(firstArg)) {
    // Import and run installer
    const { runInstaller } = await import("./installer");
    await runInstaller();
    return;
  }

  // Show help for installer commands
  if (firstArg === "--help" || firstArg === "-h") {
    console.log(`
DICOM Web Proxy

Usage: 
  ${process.argv[1]} [config-file]                    # Start proxy server
  ${process.argv[1]} [install-command] [options]      # Run installer

Proxy Commands:
  [config-file]         Start the proxy server with specified config file
  --help, -h           Show this help message

Installation Commands:
  install-rhel         Install and configure the service on RHEL/CentOS/Fedora
  test-install         Test the current installation
  uninstall-rhel       Remove the service and optionally files

Installation Options:
  --root              Run service as root for maximum compatibility
  --convert-to-root   Convert existing service to run as root

Examples:
  ${process.argv[1]} config.jsonc                              # Start proxy
  ${process.argv[1]} ./config/config.jsonc                    # Start proxy with specific config
  sudo ${process.argv[1]} install-rhel                        # Install service
  sudo ${process.argv[1]} install-rhel --root                 # Install service as root
  sudo ${process.argv[1]} install-rhel --convert-to-root      # Convert existing to root
  sudo ${process.argv[1]} test-install                        # Test installation
  sudo ${process.argv[1]} uninstall-rhel                      # Uninstall service
`);
    process.exit(0);
  }

  // Normal proxy mode
  const configPath = firstArg;
  const proxy = new DicomWebProxy(configPath);

  process.on("SIGINT", async () => {
    logger.info("Received SIGINT signal, initiating graceful shutdown");
    try {
      // Set a timeout for the shutdown process
      const shutdownPromise = proxy.stop();
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Shutdown timeout")), 10000);
      });

      await Promise.race([shutdownPromise, timeoutPromise]);
      logger.info("Graceful shutdown completed successfully");
    } catch (error) {
      logger.error(
        "Error during graceful shutdown, forcing exit",
        error instanceof Error ? error : new Error(String(error))
      );
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM signal, initiating graceful shutdown");
    try {
      // Set a timeout for the shutdown process
      const shutdownPromise = proxy.stop();
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("Shutdown timeout")), 10000);
      });

      await Promise.race([shutdownPromise, timeoutPromise]);
      logger.info("Graceful shutdown completed successfully");
    } catch (error) {
      logger.error(
        "Error during graceful shutdown, forcing exit",
        error instanceof Error ? error : new Error(String(error))
      );
    }
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    logger.fatal("Uncaught exception", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.fatal(
      "Unhandled promise rejection",
      reason instanceof Error ? reason : new Error(String(reason)),
      {
        promise: String(promise),
      }
    );
    process.exit(1);
  });

  await proxy.start();
}

main().catch((error) => {
  logger.fatal(
    "Failed to start application",
    error instanceof Error ? error : new Error(String(error))
  );
  process.exit(1);
});

export { DicomWebProxy };
export default DicomWebProxy;
