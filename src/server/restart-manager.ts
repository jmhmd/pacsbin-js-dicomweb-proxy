import { logger } from "../utils/logger";

export interface RestartOptions {
  gracePeriodMs: number; // Time to wait for graceful shutdown
  reason?: string;
}

export class RestartManager {
  private isRestarting = false;

  constructor() {}

  public async requestRestart(
    options: RestartOptions = { gracePeriodMs: 1000 }
  ): Promise<void> {
    if (this.isRestarting) {
      logger.warn('Restart already in progress, ignoring request', { component: 'RESTART_MANAGER' });
      return;
    }

    this.isRestarting = true;
    const reason = options.reason || "Configuration update";

    logger.info('Initiating graceful restart', { component: 'RESTART_MANAGER', reason });

    // Simple delay to allow any current requests to complete
    logger.info('Waiting for graceful shutdown', { component: 'RESTART_MANAGER', gracePeriodMs: options.gracePeriodMs });
    await new Promise(resolve => setTimeout(resolve, options.gracePeriodMs));

    logger.info('Grace period completed, restarting', { component: 'RESTART_MANAGER' });
    this.performRestart();
  }


  /**
   * Best-effort detection of an external supervisor that will relaunch us after
   * exit. systemd sets INVOCATION_ID/JOURNAL_STREAM for services; SUPERVISED=1
   * lets other supervisors (Docker with a restart policy, etc.) opt in.
   */
  public static isSupervised(): boolean {
    return Boolean(
      process.env['INVOCATION_ID'] ||
        process.env['JOURNAL_STREAM'] ||
        process.env['SUPERVISED'] === '1'
    );
  }

  private performRestart(): void {
    if (!RestartManager.isSupervised()) {
      // Exiting here would stop the service for good with nothing to relaunch
      // it. Warn prominently instead of silently disappearing.
      logger.warn(
        'No process supervisor detected (not running under systemd/Docker restart policy). ' +
          'Exiting now would NOT auto-restart the proxy. The process will exit to apply changes; ' +
          'you must start it again manually. Set SUPERVISED=1 to silence this warning.',
        { component: 'RESTART_MANAGER' }
      );
    }

    logger.info('Exiting process to initiate restart', { component: 'RESTART_MANAGER' });

    // Rely on process manager/systemd to restart the process
    // Using exit code 0 to indicate intentional restart (not an error)
    process.exit(0);
  }

  public isRestartInProgress(): boolean {
    return this.isRestarting;
  }

  public cancelRestart(): void {
    this.isRestarting = false;
    logger.info('Restart cancelled', { component: 'RESTART_MANAGER' });
  }
}
