import { IncomingMessage } from "node:http";

/** Default maximum request body size for control-plane endpoints (1 MiB). */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Error thrown when a request body exceeds the configured size cap. */
export class RequestBodyTooLargeError extends Error {
  public readonly statusCode = 413;
  constructor(maxBytes: number) {
    super(`Request body exceeds maximum allowed size of ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Reads a request body into a string with a hard size cap. Without a cap, a
 * slow or large POST can grow unbounded in memory. On exceeding the cap the
 * request is destroyed and the promise rejects with RequestBodyTooLargeError.
 */
export function readRequestBody(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        // Stop reading and reject; destroy the socket to release resources.
        req.destroy();
        finish(() => reject(new RequestBodyTooLargeError(maxBytes)));
        return;
      }
      chunks.push(buf);
    });

    req.on("end", () => {
      finish(() => resolve(Buffer.concat(chunks).toString("utf-8")));
    });

    req.on("error", (err) => {
      finish(() => reject(err));
    });
  });
}
