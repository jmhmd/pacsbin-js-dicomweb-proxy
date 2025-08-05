import { ServerResponse } from "node:http";
import { Buffer } from "node:buffer";

/**
 * Standard error response interface
 */
export interface ErrorResponse {
  error: string;
  statusCode: number;
  timestamp: string;
}

/**
 * Sends a standardized JSON error response
 * @param res The HTTP response object
 * @param statusCode HTTP status code (400, 404, 500, etc.)
 * @param message Error message to send to client
 */
export function sendError(
  res: ServerResponse,
  statusCode: number,
  message: string
): void {
  // Prevent sending multiple responses
  if (res.headersSent) {
    return;
  }

  const errorResponse: ErrorResponse = {
    error: message,
    statusCode,
    timestamp: new Date().toISOString(),
  };

  const jsonResponse = JSON.stringify(errorResponse);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(jsonResponse),
  });

  res.end(jsonResponse);
}

/**
 * Sends a standardized JSON success response
 * @param res The HTTP response object
 * @param data Data to send in response
 * @param statusCode HTTP status code (defaults to 200)
 */
export function sendJson(
  res: ServerResponse,
  data: any,
  statusCode: number = 200
): void {
  if (res.headersSent) {
    return;
  }

  const jsonResponse = JSON.stringify(data);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(jsonResponse),
  });

  res.end(jsonResponse);
}