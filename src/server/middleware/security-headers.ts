import { IncomingMessage, ServerResponse } from "node:http";
import { MiddlewareFunction } from "../../types";

/**
 * Adds baseline security response headers to every request. These are cheap,
 * broadly-safe defaults for an internal service: they don't affect the
 * DICOMweb JSON/multipart payloads but harden the dashboard and any browser
 * that renders a proxy response.
 *
 * The dashboard HTML sets its own Content-Security-Policy (it uses inline
 * script/style), so CSP is intentionally not set here.
 */
export class SecurityHeadersMiddleware {
  public middleware(): MiddlewareFunction {
    return (_req: IncomingMessage, res: ServerResponse, next: () => void) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      next();
    };
  }

  public static create(): SecurityHeadersMiddleware {
    return new SecurityHeadersMiddleware();
  }
}
