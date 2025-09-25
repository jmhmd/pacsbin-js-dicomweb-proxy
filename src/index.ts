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

      console.log(
        `Configuration loaded from: ${this.configManager.getConfigPath()}`
      );
      console.log(`Proxy mode: ${this.config.proxyMode}`);

      // Initialize auth system
      const authConfig: any = {
        enabled: this.config.configAuth?.enabled ?? false,
        sessionTimeout: this.config.configAuth?.sessionTimeout ?? 30
      };
      if (this.config.configAuth?.adminToken) {
        authConfig.adminToken = this.config.configAuth.adminToken;
      }
      this.authManager = new AuthManager(authConfig);
      this.authMiddleware = new AuthMiddleware(this.authManager);

      // Initialize restart manager
      this.restartManager = new RestartManager();

      // Initialize config handler
      this.configHandler = new ConfigHandler(this.configManager, this.restartManager);

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
    // console.log(
    //   `DIMSE SCP Server initialized for C-MOVE operations on port ${this.config.dimseProxySettings.proxyServer.port}`
    // );
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
        authEnabled: this.config.configAuth?.enabled ?? false
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

    // Configuration management endpoints
    this.router.post("/config/login", this.authMiddleware.getLoginHandler());
    this.router.post("/config/logout", this.authMiddleware.getLogoutHandler());
    this.router.get("/config/current", this.configHandler.getCurrentConfigHandler());
    this.router.post("/config/test", this.configHandler.getTestConfigHandler());
    this.router.post("/config/update", this.configHandler.getUpdateConfigHandler());
    this.router.post("/config/restart", this.configHandler.getRestartHandler());
    this.router.post("/config/upload-cert", this.configHandler.getUploadCertHandler());
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
    const requestTracker = this.dimseScpServer?.getRequestTracker();
    const qidoHandler = new QidoHandler(this.config, requestTracker);
    const wadoHandler = new WadoHandler(this.config, this.cache, requestTracker);

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
      console.log("Starting DICOM Web Proxy...");
      
      // Start DIMSE SCP server first if needed
      if (this.dimseScpServer) {
        // console.log("Starting DIMSE SCP server...");
        await this.dimseScpServer.start();
        // console.log("DIMSE SCP server started successfully");
      }

      // console.log("Starting HTTP server...");
      await this.server.start();
      // console.log("HTTP server started successfully");

      if (this.cleanupService) {
        this.cleanupService.start();
      }

      // console.log("DICOM Web Proxy started successfully");
      console.log(`HTTP server: http://localhost:${this.config.webserverPort}`);

      if (this.config.ssl.enabled) {
        console.log(`HTTPS server: https://localhost:${this.config.ssl.port}`);
      }

      if (this.dimseScpServer) {
        const stats = this.dimseScpServer.getStats();
        console.log(`DIMSE SCP server: ${stats.aet}@${stats.port} (C-MOVE listener)`);
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

      if (this.dimseScpServer) {
        await this.dimseScpServer.stop();
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
  const args = process.argv.slice(2);
  const firstArg = args[0];

  // Check if this is an installer command
  const installerCommands = ['install-rhel', 'test-install', 'uninstall-rhel'];
  
  if (firstArg && installerCommands.includes(firstArg)) {
    // Import and run installer
    const { runInstaller } = await import('./installer');
    await runInstaller();
    return;
  }

  // Show help for installer commands
  if (firstArg === '--help' || firstArg === '-h') {
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
    console.log("\\nReceived SIGINT, shutting down gracefully...");
    try {
      // Set a timeout for the shutdown process
      const shutdownPromise = proxy.stop();
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Shutdown timeout')), 10000);
      });
      
      await Promise.race([shutdownPromise, timeoutPromise]);
      console.log("Shutdown completed successfully");
    } catch (error) {
      console.error("Error during shutdown:", error);
      console.log("Forcing exit...");
    }
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\\nReceived SIGTERM, shutting down gracefully...");
    try {
      // Set a timeout for the shutdown process
      const shutdownPromise = proxy.stop();
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Shutdown timeout')), 10000);
      });
      
      await Promise.race([shutdownPromise, timeoutPromise]);
      console.log("Shutdown completed successfully");
    } catch (error) {
      console.error("Error during shutdown:", error);
      console.log("Forcing exit...");
    }
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

main().catch((error) => {
  console.error("Failed to start application:", error);
  process.exit(1);
});

export { DicomWebProxy };
export default DicomWebProxy;
