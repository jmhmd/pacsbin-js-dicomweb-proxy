import { logger } from "./logger";

/**
 * Override dcmjs-dimse logger to integrate with our structured logging
 */
export function setupDcmjsDimseLogging(DcmjsDimse: any): void {
  const dcmjsLog = DcmjsDimse.log;

  if (!dcmjsLog) {
    logger.warn("dcmjs-dimse log module not found", { component: "LOGGER" });
    return;
  }

  // Enable logging in dcmjs-dimse
  dcmjsLog.enableAll();

  // Override with our structured logger
  dcmjsLog.trace = (...args: any[]) => {
    const message = formatDcmjsMessage(args);
    logger.debug(message, { component: "DCMJS_DIMSE" });
  };

  dcmjsLog.debug = (...args: any[]) => {
    const message = formatDcmjsMessage(args);
    logger.debug(message, { component: "DCMJS_DIMSE" });
  };

  dcmjsLog.info = (...args: any[]) => {
    const message = formatDcmjsMessage(args);
    logger.info(message, { component: "DCMJS_DIMSE" });
  };

  dcmjsLog.warn = (...args: any[]) => {
    const message = formatDcmjsMessage(args);
    logger.warn(message, { component: "DCMJS_DIMSE" });
  };

  dcmjsLog.error = (...args: any[]) => {
    const { message, error } = formatDcmjsMessageWithError(args);
    logger.error(message, error, { component: "DCMJS_DIMSE" });
  };

  logger.info("dcmjs-dimse logging override enabled", { component: "LOGGER" });
}

/**
 * Format dcmjs-dimse log arguments while preserving formatting
 */
function formatDcmjsMessage(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (
        typeof arg === "object" &&
        arg !== null &&
        typeof arg.toString === "function"
      ) {
        // Call toString() to preserve object formatting (like Association.toString())
        return arg.toString();
      }
      return JSON.stringify(arg);
    })
    .join(""); // Use empty string to preserve original spacing/EOL
}

/**
 * Format dcmjs-dimse log arguments and extract error objects
 */
function formatDcmjsMessageWithError(args: any[]) {
  const errorArg = args.find((arg) => arg instanceof Error);

  const message = args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.message;
      }
      if (typeof arg === "string") {
        return arg;
      }
      if (
        typeof arg === "object" &&
        arg !== null &&
        typeof arg.toString === "function"
      ) {
        return arg.toString();
      }
      return JSON.stringify(arg);
    })
    .join("");

  return { message, error: errorArg };
}
