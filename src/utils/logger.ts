import pino from "pino";
import pretty from "pino-pretty";
import { DashboardLogTransport } from "../server/dashboard-log-transport";

export interface LogContext {
  requestId?: string | undefined;
  operation?: string | undefined;
  studyInstanceUID?: string | undefined;
  seriesInstanceUID?: string | undefined;
  sopInstanceUID?: string | undefined;
  userAgent?: string | undefined;
  clientAet?: string | undefined;
  peerAet?: string | undefined;
  method?: string | undefined;
  url?: string | undefined;
  correlationId?: string | undefined;
  status?: any;
  failed?: number | undefined;
  warnings?: number | undefined;
  [key: string]: any;
}

export class Logger {
  private static instance: Logger;
  private pinoLogger: pino.Logger;
  private dashboardTransport: DashboardLogTransport;

  private constructor() {
    this.dashboardTransport = new DashboardLogTransport();


    // Create multistream logger
    this.pinoLogger = pino(
      {
        level: process.env["LOG_LEVEL"] || "info",
        timestamp: () => `,"time":"${new Date().toISOString()}"`,
        formatters: {
          level: (label) => {
            return { level: label };
          },
        },
      },
      pino.multistream([
        // Keep stdout for platform logging (Docker, systemd, etc.)
        // Use pretty format in development for better readability
        {
          stream: /* process.env["NODE_ENV"] === "development"
            ? */ pretty({
                colorize: true,
                translateTime: "SYS:standard",
                ignore: "pid,hostname,component",
                messageFormat: (log, messageKey) => {
                  const component = log['component'] ? `[${log['component']}] ` : '';
                  return `${component}${log[messageKey]}`;
                }
              }),
            /* : process.stdout, */
          level: process.env["STDOUT_LOG_LEVEL"] || "info"
        },
        // Dashboard transport for real-time streaming
        {
          stream: this.dashboardTransport,
          level: process.env["DASHBOARD_LOG_LEVEL"] || "info"
        },
      ])
    );
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public getDashboardTransport(): DashboardLogTransport {
    return this.dashboardTransport;
  }

  public info(msg: string, context?: LogContext): void {
    this.pinoLogger.info(context || {}, msg);
  }

  public warn(msg: string, context?: LogContext): void {
    this.pinoLogger.warn(context || {}, msg);
  }

  public error(msg: string, error?: unknown, context?: LogContext): void {
    const errorContext = {
      ...(context || {}),
      ...(this.normalizeError(error)),
    };
    this.pinoLogger.error(errorContext, msg);
  }

  public debug(msg: string, context?: LogContext): void {
    this.pinoLogger.debug(context || {}, msg);
  }

  public fatal(msg: string, error?: unknown, context?: LogContext): void {
    const errorContext = {
      ...(context || {}),
      ...(this.normalizeError(error)),
    };
    this.pinoLogger.fatal(errorContext, msg);
  }

  private normalizeError(error?: unknown): { error?: { name: string; message: string; stack?: string } } {
    if (!error) return {};

    if (error instanceof Error) {
      const errorObj: { name: string; message: string; stack?: string } = {
        name: error.name,
        message: error.message,
      };

      if (error.stack !== undefined) {
        errorObj.stack = error.stack;
      }

      return { error: errorObj };
    }

    return {
      error: {
        name: 'Error',
        message: String(error),
      },
    };
  }
}

// Export singleton instance for easy access
export const logger = Logger.getInstance();