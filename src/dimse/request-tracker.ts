import { randomUUID } from "node:crypto";
import { PendingCMoveRequest, CStoreValidationResult, DimseDataset } from "../types";

export class CMoveRequestTracker {
  private pendingRequests = new Map<string, PendingCMoveRequest>();
  private cleanupInterval: NodeJS.Timeout | number;

  constructor(private defaultTimeoutMs: number = 30000) {
    // Clean up expired requests every 10 seconds
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredRequests();
    }, 10000);
  }

  /**
   * Register a new C-MOVE request and return correlation ID
   */
  public registerCMoveRequest(
    studyInstanceUID: string,
    seriesInstanceUID?: string,
    sopInstanceUID?: string,
    timeoutMs?: number
  ): Promise<{ correlationId: string; promise: Promise<DimseDataset[]> }> {
    const correlationId = randomUUID();
    
    return new Promise((resolve, reject) => {
      const pendingRequest: PendingCMoveRequest = {
        correlationId,
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID,
        timestamp: new Date(),
        timeoutMs: timeoutMs || this.defaultTimeoutMs,
        receivedInstances: 0,
        datasets: [],
        resolve: (datasets: DimseDataset[]) => {
          this.pendingRequests.delete(correlationId);
          resolve({ correlationId, promise: Promise.resolve(datasets) });
        },
        reject: (error: Error) => {
          this.pendingRequests.delete(correlationId);
          reject(error);
        }
      };

      this.pendingRequests.set(correlationId, pendingRequest);
      
      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(correlationId)) {
          this.pendingRequests.delete(correlationId);
          reject(new Error(`C-MOVE request timed out after ${timeoutMs || this.defaultTimeoutMs}ms`));
        }
      }, timeoutMs || this.defaultTimeoutMs);

      // Immediately return the correlation info and promise
      const promise = new Promise<DimseDataset[]>((resolveDatasets, rejectDatasets) => {
        pendingRequest.resolve = (datasets: DimseDataset[]) => {
          this.pendingRequests.delete(correlationId);
          resolveDatasets(datasets);
        };
        pendingRequest.reject = (error: Error) => {
          this.pendingRequests.delete(correlationId);
          rejectDatasets(error);
        };
      });

      resolve({ correlationId, promise });
    });
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
      console.warn(`No pending request found for correlation ID: ${correlationId}`);
      return false;
    }

    // Add the dataset to the request
    request.datasets.push(dataset);
    request.receivedInstances++;

    console.log(`C-STORE received for ${correlationId}: ${request.receivedInstances} instances`);

    // For now, we complete the request after receiving any dataset
    // In a more sophisticated implementation, we could wait for all expected instances
    // based on the C-MOVE response information
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

    console.log(`Completing C-MOVE request ${correlationId} with ${request.datasets.length} datasets`);
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
      console.log(`Cleaning up expired C-MOVE request: ${correlationId}`);
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
      clearInterval(this.cleanupInterval as any);
    }

    // Cancel all pending requests
    for (const correlationId of this.pendingRequests.keys()) {
      this.cancelRequest(correlationId, 'Server shutting down');
    }
  }
}