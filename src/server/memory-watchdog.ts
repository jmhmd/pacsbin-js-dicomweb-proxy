import { logger } from "../utils/logger";
import { RestartManager } from "./restart-manager";

export interface MemoryWatchdogOptions {
  /** Hard RSS limit in bytes. */
  limitBytes: number;
  /** Sampling interval in ms. */
  intervalMs?: number;
  /** Consecutive over-limit samples before requesting a restart. */
  breachesBeforeRestart?: number;
}

/**
 * Samples process RSS on an interval. Logs a warning as memory approaches the
 * configured limit and, if a supervisor is present to relaunch the process,
 * requests a restart after RSS stays over the limit for several samples in a
 * row — a self-healing safety net for any residual leak. Without a supervisor
 * it only warns (exiting would stop the service for good).
 */
export class MemoryWatchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveBreaches = 0;
  private readonly limitBytes: number;
  private readonly intervalMs: number;
  private readonly breachesBeforeRestart: number;

  constructor(
    private restartManager: RestartManager,
    options: MemoryWatchdogOptions
  ) {
    this.limitBytes = options.limitBytes;
    this.intervalMs = options.intervalMs ?? 30_000;
    this.breachesBeforeRestart = options.breachesBeforeRestart ?? 3;
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    if (typeof (this.timer as any).unref === "function") {
      (this.timer as any).unref();
    }
    logger.info("Memory watchdog started", {
      component: "MEMORY_WATCHDOG",
      limitMB: Math.round(this.limitBytes / (1024 * 1024)),
      intervalMs: this.intervalMs,
    });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private sample(): void {
    const rss = process.memoryUsage().rss;

    if (rss <= this.limitBytes * 0.85) {
      this.consecutiveBreaches = 0;
      return;
    }

    const rssMB = Math.round(rss / (1024 * 1024));
    const limitMB = Math.round(this.limitBytes / (1024 * 1024));

    if (rss <= this.limitBytes) {
      logger.warn("Memory approaching configured limit", {
        component: "MEMORY_WATCHDOG",
        rssMB,
        limitMB,
      });
      return;
    }

    this.consecutiveBreaches += 1;
    logger.error("Memory over configured limit", undefined, {
      component: "MEMORY_WATCHDOG",
      rssMB,
      limitMB,
      consecutiveBreaches: this.consecutiveBreaches,
    });

    if (this.consecutiveBreaches < this.breachesBeforeRestart) {
      return;
    }

    if (!RestartManager.isSupervised()) {
      logger.error(
        "Memory over limit but no supervisor present to relaunch; not exiting. " +
          "Investigate the leak or run under systemd/Docker so the watchdog can self-heal.",
        undefined,
        { component: "MEMORY_WATCHDOG" }
      );
      // Reset so we warn again after another full breach window rather than
      // spamming every interval.
      this.consecutiveBreaches = 0;
      return;
    }

    logger.error(
      "Memory over limit for sustained period; requesting supervised restart",
      undefined,
      { component: "MEMORY_WATCHDOG", rssMB, limitMB }
    );
    this.stop();
    void this.restartManager.requestRestart({
      gracePeriodMs: 2000,
      reason: "Memory watchdog: RSS over configured limit",
    });
  }
}
