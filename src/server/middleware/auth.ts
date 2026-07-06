import { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

export interface DashboardAuthConfig {
  enabled: boolean;
  username: string;
  password: string;
}

// After this many consecutive failures from one client, further attempts are
// briefly refused with 429 to blunt online password guessing.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
// Cap the tracking map so a flood of distinct source IPs can't grow it without
// bound; entries are also pruned once their lockout window has elapsed.
const MAX_TRACKED_CLIENTS = 10_000;

interface AttemptRecord {
  fails: number;
  blockedUntil: number;
}

export class BasicAuthMiddleware {
  private config: DashboardAuthConfig;
  private attempts = new Map<string, AttemptRecord>();

  constructor(config: DashboardAuthConfig) {
    this.config = config;
  }

  public requireBasicAuth = () => {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (!this.config.enabled) {
        return next();
      }

      const clientKey = this.getClientKey(req);

      if (this.isLockedOut(clientKey)) {
        this.sendTooManyAttempts(res);
        return;
      }

      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Basic ")) {
        this.sendAuthRequired(res);
        return;
      }

      // Decode base64 credentials
      const base64Credentials = authHeader.substring(6);
      const credentials = Buffer.from(base64Credentials, "base64").toString(
        "utf-8"
      );
      const separatorIndex = credentials.indexOf(":");
      const username =
        separatorIndex >= 0 ? credentials.slice(0, separatorIndex) : credentials;
      const password =
        separatorIndex >= 0 ? credentials.slice(separatorIndex + 1) : "";

      // Constant-time comparison of both fields to avoid leaking correctness
      // via response timing. Always compare both so timing doesn't reveal which
      // field was wrong.
      const userOk = this.safeEqual(username, this.config.username);
      const passOk = this.safeEqual(password, this.config.password);

      if (userOk && passOk) {
        this.attempts.delete(clientKey);
        return next();
      }

      this.recordFailure(clientKey);
      this.sendAuthRequired(res);
    };
  };

  private safeEqual(a: string, b: string): boolean {
    // Hash to a fixed length first so timingSafeEqual never throws on length
    // mismatch and the comparison itself doesn't leak the credential length.
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
  }

  private getClientKey(req: IncomingMessage): string {
    return req.socket?.remoteAddress ?? "unknown";
  }

  private isLockedOut(clientKey: string): boolean {
    const record = this.attempts.get(clientKey);
    if (!record) {
      return false;
    }
    if (record.blockedUntil > Date.now()) {
      return true;
    }
    if (record.blockedUntil !== 0 && record.blockedUntil <= Date.now()) {
      // Lockout window elapsed — reset so the client gets a fresh set of tries.
      this.attempts.delete(clientKey);
    }
    return false;
  }

  private recordFailure(clientKey: string): void {
    if (
      this.attempts.size >= MAX_TRACKED_CLIENTS &&
      !this.attempts.has(clientKey)
    ) {
      this.pruneExpired();
    }

    const record = this.attempts.get(clientKey) ?? {
      fails: 0,
      blockedUntil: 0,
    };
    record.fails += 1;
    if (record.fails >= MAX_FAILED_ATTEMPTS) {
      record.blockedUntil = Date.now() + LOCKOUT_MS;
      record.fails = 0;
    }
    this.attempts.set(clientKey, record);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.attempts) {
      if (record.blockedUntil !== 0 && record.blockedUntil <= now) {
        this.attempts.delete(key);
      }
    }
  }

  private sendAuthRequired(res: ServerResponse): void {
    res.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="DICOM Web Proxy Dashboard"',
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify({
        error: "Authentication required",
        statusCode: 401,
        timestamp: new Date().toISOString(),
      })
    );
  }

  private sendTooManyAttempts(res: ServerResponse): void {
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(Math.ceil(LOCKOUT_MS / 1000)),
    });
    res.end(
      JSON.stringify({
        error: "Too many failed authentication attempts. Try again later.",
        statusCode: 429,
        timestamp: new Date().toISOString(),
      })
    );
  }
}
