import { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";

export interface AuthConfig {
  enabled: boolean;
  adminToken?: string;
  sessionTimeout: number; // in minutes
}

export interface AuthSession {
  token: string;
  expires: Date;
  created: Date;
}

export class AuthManager {
  private config: AuthConfig;
  private sessions: Map<string, AuthSession> = new Map();
  private adminTokenHash: string | null = null;

  constructor(config: AuthConfig) {
    this.config = config;
    if (config.enabled && config.adminToken) {
      this.adminTokenHash = this.hashToken(config.adminToken);
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateSessionToken(): string {
    return randomBytes(32).toString('hex');
  }

  public authenticate(password: string): string | null {
    if (!this.config.enabled) {
      return 'no-auth-required';
    }

    if (!this.adminTokenHash || !password) {
      return null;
    }

    const passwordHash = this.hashToken(password);
    if (passwordHash !== this.adminTokenHash) {
      return null;
    }

    // Create new session
    const sessionToken = this.generateSessionToken();
    const expires = new Date(Date.now() + this.config.sessionTimeout * 60 * 1000);

    this.sessions.set(sessionToken, {
      token: sessionToken,
      expires,
      created: new Date()
    });

    // Clean up expired sessions
    this.cleanupExpiredSessions();

    return sessionToken;
  }

  public validateSession(sessionToken: string): boolean {
    if (!this.config.enabled) {
      return true;
    }

    if (!sessionToken) {
      return false;
    }

    const session = this.sessions.get(sessionToken);
    if (!session) {
      return false;
    }

    if (session.expires < new Date()) {
      this.sessions.delete(sessionToken);
      return false;
    }

    return true;
  }

  public revokeSession(sessionToken: string): void {
    this.sessions.delete(sessionToken);
  }

  public revokeAllSessions(): void {
    this.sessions.clear();
  }

  private cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [token, session] of this.sessions) {
      if (session.expires < now) {
        this.sessions.delete(token);
      }
    }
  }

  public getSessionCount(): number {
    this.cleanupExpiredSessions();
    return this.sessions.size;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }
}

export class AuthMiddleware {
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;
  }

  public isAuthenticated(req: IncomingMessage): boolean {
    // If auth is disabled, allow access
    if (!this.authManager.isEnabled()) {
      return true;
    }

    // Check for log endpoints - require auth
    if (req.url?.startsWith('/logs/')) {
      const sessionToken = this.extractSessionToken(req);
      return this.authManager.validateSession(sessionToken);
    }

    return true;
  }

  public requireAuth = () => {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      // Skip auth check for non-config endpoints
      if (!req.url?.startsWith('/config/')) {
        return next();
      }

      // Allow login endpoint
      if (req.url === '/config/login') {
        return next();
      }

      const sessionToken = this.extractSessionToken(req);

      if (!this.authManager.validateSession(sessionToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Authentication required',
          statusCode: 401,
          timestamp: new Date().toISOString()
        }));
        return;
      }

      next();
    };
  };

  private extractSessionToken(req: IncomingMessage): string {
    // Try Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try cookie
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const cookies = this.parseCookies(cookieHeader);
      return cookies['sessionToken'] || '';
    }

    return '';
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
    return cookies;
  }

  public getLoginHandler() {
    return async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      try {
        const body = await this.parseRequestBody(req);
        const { password } = JSON.parse(body);

        const sessionToken = this.authManager.authenticate(password);

        if (!sessionToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Invalid password',
            statusCode: 401,
            timestamp: new Date().toISOString()
          }));
          return;
        }

        // Set session cookie
        const cookieExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `sessionToken=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Expires=${cookieExpires.toUTCString()}`
        });

        res.end(JSON.stringify({
          success: true,
          sessionToken,
          expires: cookieExpires.toISOString()
        }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    };
  }

  public getLogoutHandler() {
    return async (req: IncomingMessage, res: ServerResponse) => {
      const sessionToken = this.extractSessionToken(req);
      if (sessionToken) {
        this.authManager.revokeSession(sessionToken);
      }

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'sessionToken=; HttpOnly; Secure; SameSite=Strict; Max-Age=0'
      });
      res.end(JSON.stringify({ success: true }));
    };
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
}