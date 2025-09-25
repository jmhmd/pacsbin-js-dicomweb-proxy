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
      console.log("Restart already in progress, ignoring request");
      return;
    }

    this.isRestarting = true;
    const reason = options.reason || "Configuration update";

    console.log(`🔄 Initiating graceful restart: ${reason}`);

    // Simple delay to allow any current requests to complete
    console.log(`⏳ Waiting ${options.gracePeriodMs}ms for graceful shutdown...`);
    await new Promise(resolve => setTimeout(resolve, options.gracePeriodMs));

    console.log("✅ Grace period completed, restarting...");
    this.performRestart();
  }


  private performRestart(): void {
    console.log("🚀 Restarting process...");

    // Rely on process manager/systemd to restart the process
    // Using exit code 0 to indicate intentional restart (not an error)
    process.exit(0);
  }

  public isRestartInProgress(): boolean {
    return this.isRestarting;
  }

  public cancelRestart(): void {
    this.isRestarting = false;
    console.log("🚫 Restart cancelled");
  }
}
