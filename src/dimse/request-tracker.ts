import { randomUUID } from "node:crypto";
import { PendingCMoveRequest, CStoreValidationResult, DimseDataset } from "../types";
import { logger } from "../utils/logger";

export class CMoveRequestTracker {
  private pendingRequests = new Map<string, PendingCMoveRequest>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private defaultTimeoutMs: number = 30000) {
    // Clean up expired requests every 10 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, 10000);
  }

  /**
   * Register a new C-MOVE request and return correlation ID and result promise.
   * Synchronous — no async wrapper needed since all operations are synchronous.
   * The returned promise resolves with datasets when C-STOREs arrive, or rejects
   * on timeout/cancellation.
   */
  public registerCMoveRequest(
    studyInstanceUID: string,
    seriesInstanceUID?: string,
    sopInstanceUID?: string,
    timeoutMs?: number
  ): { correlationId: string; promise: Promise<DimseDataset[]> } {
    const correlationId = randomUUID();
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    // Capture promise settle functions before the pendingRequest is built,
    // so resolve/reject on the request directly settle this single promise.
    let resolveDatasets!: (datasets: DimseDataset[]) => void;
    let rejectDatasets!: (error: Error) => void;

    const promise = new Promise<DimseDataset[]>((res, rej) => {
      resolveDatasets = res;
      rejectDatasets = rej;
    });

    const pendingRequest: PendingCMoveRequest = {
      correlationId,
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
      timestamp: new Date(),
      timeoutMs: effectiveTimeout,
      receivedInstances: 0,
      datasets: [],
      resolve: (datasets: DimseDataset[]) => {
        if (pendingRequest.timeoutId) clearTimeout(pendingRequest.timeoutId);
        this.pendingRequests.delete(correlationId);
        resolveDatasets(datasets);
      },
      reject: (error: Error) => {
        if (pendingRequest.timeoutId) clearTimeout(pendingRequest.timeoutId);
        this.pendingRequests.delete(correlationId);
        rejectDatasets(error);
      },
    };

    const timeoutId = setTimeout(() => {
      if (this.pendingRequests.has(correlationId)) {
        pendingRequest.reject(new Error(`C-MOVE request timed out after ${effectiveTimeout}ms`));
      }
    }, effectiveTimeout);

    pendingRequest.timeoutId = timeoutId;
    this.pendingRequests.set(correlationId, pendingRequest);

    return { correlationId, promise };
  }

  /**
   * Validate incoming C-STORE request against pending C-MOVE operations
   */
  public validateCStoreRequest(
    studyInstanceUID: string,
    seriesInstanceUID?: string,
    sopInstanceUID?: string
  ): CStoreValidationResult {
    // Look for matching pending requests
    for (const [correlationId, request] of this.pendingRequests) {
      if (this.matchesRequest(request, studyInstanceUID, seriesInstanceUID, sopInstanceUID)) {
        return {
          isValid: true,
          correlationId,
        };
      }
    }

    return {
      isValid: false,
      reason: `No pending C-MOVE request for Study: ${studyInstanceUID}, Series: ${seriesInstanceUID || 'any'}, Instance: ${sopInstanceUID || 'any'}`,
    };
  }

  /**
   * Process incoming C-STORE dataset for a validated request
   */
  public processCStoreDataset(correlationId: string, dataset: DimseDataset): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      logger.warn(`No pending request found for correlation ID: ${correlationId}`);
      return false;
    }

    // Add the dataset to the request
    request.datasets.push(dataset);
    request.receivedInstances++;

    logger.debug(`C-STORE received for ${correlationId}: ${request.receivedInstances}/${request.expectedInstances || '?'} instances`);

    // Check if we've received all expected instances
    if (request.expectedInstances !== undefined && request.receivedInstances >= request.expectedInstances) {
      logger.debug(`All ${request.expectedInstances} instances received for ${correlationId}, completing request`);
      this.completeRequest(correlationId);
    }
    // If we don't know how many to expect yet, don't complete
    // The C-MOVE response handler will call completeRequest when C-MOVE finishes

    return true;
  }

  /**
   * Update the expected instance count for a pending request
   */
  public setExpectedInstances(correlationId: string, expectedInstances: number): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      logger.warn(`Cannot set expected instances: No pending request found for correlation ID: ${correlationId}`);
      return false;
    }

    request.expectedInstances = expectedInstances;
    logger.debug(`C-MOVE ${correlationId}: Expecting ${expectedInstances} instances (currently received: ${request.receivedInstances})`);

    // Check if we already have all instances (race condition where C-STOREs arrived before we knew the count)
    if (request.receivedInstances >= expectedInstances) {
      logger.debug(`Already received all ${expectedInstances} instances for ${correlationId}, completing now`);
      this.completeRequest(correlationId);
    }

    return true;
  }

  /**
   * Mark that C-MOVE has completed. If expected instances != received, log warning but complete anyway.
   * This handles cases where C-MOVE reports completion but some C-STOREs failed or were never sent.
   */
  public markCMoveCompleted(correlationId: string): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      // Request may have already been completed by C-STORE collection
      logger.debug(`C-MOVE ${correlationId} marked complete, but request already finished (likely all C-STOREs received)`);
      return false;
    }

    // If we have expected count and haven't received all, log a warning
    if (request.expectedInstances !== undefined && request.receivedInstances < request.expectedInstances) {
      logger.warn(
        `C-MOVE ${correlationId} completed but only received ${request.receivedInstances}/${request.expectedInstances} instances. ` +
        `Completing with partial results.`
      );
    } else {
      logger.debug(`C-MOVE ${correlationId} completed with ${request.receivedInstances} instances`);
    }

    // Complete with whatever we have
    this.completeRequest(correlationId);
    return true;
  }

  /**
   * Complete a C-MOVE request with all received datasets
   */
  public completeRequest(correlationId: string): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      return false;
    }

    logger.info(`Completing C-MOVE request ${correlationId} with ${request.datasets.length} datasets`);
    request.resolve(request.datasets);
    return true;
  }

  /**
   * Cancel a pending C-MOVE request
   */
  public cancelRequest(correlationId: string, reason?: string): boolean {
    const request = this.pendingRequests.get(correlationId);
    if (!request) {
      return false;
    }

    // request.reject() handles clearing the timeout and removing from the map
    request.reject(new Error(reason || 'Request cancelled'));
    return true;
  }

  /**
   * Get statistics about pending requests
   */
  public getStats(): { pending: number; totalTracked: number } {
    return {
      pending: this.pendingRequests.size,
      totalTracked: this.pendingRequests.size, // Could track historical count
    };
  }

  /**
   * Cleanup expired requests
   */
  private cleanupExpiredRequests(): void {
    const now = new Date();
    const expired: string[] = [];

    for (const [correlationId, request] of this.pendingRequests) {
      const age = now.getTime() - request.timestamp.getTime();
      if (age > request.timeoutMs) {
        expired.push(correlationId);
      }
    }

    for (const correlationId of expired) {
      logger.info(`Cleaning up expired C-MOVE request: ${correlationId}`);
      this.cancelRequest(correlationId, 'Request expired');
    }
  }

  /**
   * Check if a C-STORE request matches a pending C-MOVE
   */
  private matchesRequest(
    request: PendingCMoveRequest,
    studyInstanceUID: string,
    seriesInstanceUID?: string,
    sopInstanceUID?: string
  ): boolean {
    // Study must always match
    if (request.studyInstanceUID !== studyInstanceUID) {
      return false;
    }

    // If request specified series, it must match
    if (request.seriesInstanceUID && seriesInstanceUID && request.seriesInstanceUID !== seriesInstanceUID) {
      return false;
    }

    // If request specified instance, it must match
    if (request.sopInstanceUID && sopInstanceUID && request.sopInstanceUID !== sopInstanceUID) {
      return false;
    }

    return true;
  }

  /**
   * Shutdown the request tracker
   */
  public shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Cancel all pending requests
    for (const correlationId of this.pendingRequests.keys()) {
      this.cancelRequest(correlationId, 'Server shutting down');
    }
  }
}