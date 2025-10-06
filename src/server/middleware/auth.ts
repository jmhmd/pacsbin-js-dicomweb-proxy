import { IncomingMessage, ServerResponse } from "node:http";

export interface DashboardAuthConfig {
  enabled: boolean;
  username: string;
  password: string;
}

export class BasicAuthMiddleware {
  private config: DashboardAuthConfig;

  constructor(config: DashboardAuthConfig) {
    this.config = config;
  }

  public requireBasicAuth = () => {
    return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (!this.config.enabled) {
        return next();
      }

      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Basic ')) {
        this.sendAuthRequired(res);
        return;
      }

      // Decode base64 credentials
      const base64Credentials = authHeader.substring(6);
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
      const [username, password] = credentials.split(':');

      // Validate credentials
      if (username === this.config.username && password === this.config.password) {
        return next();
      }

      this.sendAuthRequired(res);
    };
  };

  private sendAuthRequired(res: ServerResponse): void {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="DICOM Web Proxy Dashboard"',
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({
      error: 'Authentication required',
      statusCode: 401,
      timestamp: new Date().toISOString()
    }));
  }
}