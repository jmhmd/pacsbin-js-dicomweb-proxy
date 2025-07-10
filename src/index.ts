#!/usr/bin/env node

import { IncomingMessage, ServerResponse } from "http";
import { ConfigManager } from "./config/config";
import { ProxyServer } from "./server/http-server";
import { Router } from "./server/router";
import { CorsMiddleware } from "./server/middleware/cors";
import { QidoHandler } from "./handlers/qido";
import { WadoHandler } from "./handlers/wado";
import { DicomWebProxyHandler } from "./handlers/dicomweb-proxy";
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

      if (this.config.proxyMode === "dimse") {
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
        cache: this.cache ? this.cache.getStats() : null,
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
  }

  private setupDimseRoutes(): void {
    if (!this.cache) {
      throw new Error("Cache not initialized for DIMSE mode");
    }

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
