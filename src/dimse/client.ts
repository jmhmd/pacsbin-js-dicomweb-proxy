import DcmjsDimse from "dcmjs-dimse";
import type { responses as IResponses } from "dcmjs-dimse";
import { ProxyConfig, DicomDataset, DimseDataset } from "../types";
import { CMoveRequestTracker } from "./request-tracker";
import { ConnectionQueue } from "./connection-queue";

const { Client, requests, responses, constants } = DcmjsDimse;
const { CFindRequest, CGetRequest, CMoveRequest, CEchoRequest } = requests;
const { CStoreResponse } = responses;
const { Status } = constants;

export interface FindResult {
  datasets: DicomDataset[];
  completed: boolean;
  error?: string | undefined;
}

export interface RetrieveResult {
  datasets: DimseDataset[];
  completed: boolean;
  failed: number;
  warnings: number;
  error?: string | undefined;
}

/**
 * IMPORTANT: All methods in this class must wait for the Client 'closed' event
 * before resolving their promises. This ensures proper resource cleanup and prevents
 * memory leaks under high load.
 *
 * Issue: Each dcmjs-dimse Client instance maintains network sockets, event listeners,
 * and internal buffers. If promises resolve immediately upon receiving responses
 * (before the connection fully closes), the system can create new Clients faster than
 * old ones can be garbage collected. This causes accumulation of:
 * - Unclosed network connections (socket exhaustion)
 * - Event listeners (memory leaks)
 * - Internal buffers (memory growth)
 *
 * Fix: Wait for the 'closed' event before resolving. This provides natural backpressure,
 * ensuring Clients are fully disposed before processing continues and new Clients are created.
 */
export class DimseClient {
  private config: ProxyConfig["dimseProxySettings"];
  private requestTracker?: CMoveRequestTracker | undefined;
  private connectionQueue: ConnectionQueue;

  constructor(
    config: ProxyConfig["dimseProxySettings"],
    requestTracker?: CMoveRequestTracker | undefined,
    maxConcurrentConnections: number = 1,
    delayBetweenRequestsMs: number = 100
  ) {
    if (!config) {
      throw new Error("DIMSE proxy settings are required");
    }
    this.config = config;
    this.requestTracker = requestTracker;
    this.connectionQueue = new ConnectionQueue(maxConcurrentConnections, delayBetweenRequestsMs);

    console.log(`DimseClient initialized with max ${maxConcurrentConnections} concurrent connections, ${delayBetweenRequestsMs}ms delay between requests`);
  }

  /**
   * Get connection queue statistics
   */
  public getQueueStats(): { active: number; queued: number; maxConcurrent: number } {
    return this.connectionQueue.getStats();
  }

  public async findStudies(query: DicomDataset): Promise<FindResult> {
    // Queue the request to limit concurrent connections
    return this.connectionQueue.enqueue(() => this.executeFindStudies(query));
  }

  private async executeFindStudies(query: DicomDataset): Promise<FindResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = CFindRequest.createStudyFindRequest(query);

      (request as any).on("response", (response: IResponses.CFindResponse) => {
        if (response.getStatus() === Status.Pending && response.hasDataset()) {
          const dataset = response.getDataset();
          if (dataset) {
            results.push(dataset);
          }
        } else if (response.getStatus() === Status.Success) {
          completed = true;
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
        }
      });

      (client as any).on("closed", () => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve({
            datasets: results,
            completed,
            error,
          });
        }
      });

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
      });

      client.addRequest(request);
      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async findSeries(query: DicomDataset): Promise<FindResult> {
    // Queue the request to limit concurrent connections
    return this.connectionQueue.enqueue(() => this.executeFindSeries(query));
  }

  private async executeFindSeries(query: DicomDataset): Promise<FindResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = CFindRequest.createSeriesFindRequest(query);

      (request as any).on("response", (response: IResponses.CFindResponse) => {
        if (response.getStatus() === Status.Pending && response.hasDataset()) {
          const dataset = response.getDataset();
          if (dataset) {
            results.push(dataset);
          }
        } else if (response.getStatus() === Status.Success) {
          completed = true;
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
        }
      });

      (client as any).on("closed", () => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve({
            datasets: results,
            completed,
            error,
          });
        }
      });

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
      });

      client.addRequest(request);
      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async findInstances(query: DicomDataset): Promise<FindResult> {
    // Queue the request to limit concurrent connections
    return this.connectionQueue.enqueue(() => this.executeFindInstances(query));
  }

  private async executeFindInstances(query: DicomDataset): Promise<FindResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = CFindRequest.createImageFindRequest(query);

      (request as any).on("response", (response: IResponses.CFindResponse) => {
        if (response.getStatus() === Status.Pending && response.hasDataset()) {
          const dataset = response.getDataset();
          if (dataset) {
            results.push(dataset);
          }
        } else if (response.getStatus() === Status.Success) {
          completed = true;
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
        }
      });

      (client as any).on("closed", () => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve({
            datasets: results,
            completed,
            error,
          });
        }
      });

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
      });

      client.addRequest(request);
      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveStudy(
    studyInstanceUID: string,
    useCGet: boolean = false
  ): Promise<RetrieveResult> {
    // C-MOVE requires SCP server integration
    if (!useCGet) {
      if (!this.requestTracker) {
        throw new Error("C-MOVE requires SCP server configuration (requestTracker)");
      }
      return this.connectionQueue.enqueue(() => this.retrieveWithCMove(studyInstanceUID));
    }

    // C-GET: retrieve directly to this client
    return this.connectionQueue.enqueue(() => this.retrieveWithCGet(studyInstanceUID));
  }

  public async retrieveSeries(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    useCGet: boolean = false
  ): Promise<RetrieveResult> {
    // C-MOVE requires SCP server integration
    if (!useCGet) {
      if (!this.requestTracker) {
        throw new Error("C-MOVE requires SCP server configuration (requestTracker)");
      }
      return this.connectionQueue.enqueue(() => this.retrieveWithCMove(studyInstanceUID, seriesInstanceUID));
    }

    // C-GET: retrieve directly to this client
    return this.connectionQueue.enqueue(() => this.retrieveWithCGet(studyInstanceUID, seriesInstanceUID));
  }

  public async retrieveInstance(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    useCGet: boolean = false
  ): Promise<RetrieveResult> {
    const queueStats = this.connectionQueue.getStats();
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] retrieveInstance called for ${sopInstanceUID.substring(0, 20)}... (Queue: ${queueStats.queued} waiting, ${queueStats.active}/${queueStats.maxConcurrent} active)`);

    // C-MOVE requires SCP server integration
    if (!useCGet) {
      if (!this.requestTracker) {
        throw new Error("C-MOVE requires SCP server configuration (requestTracker)");
      }
      console.log(`[${timestamp}] Using C-MOVE for ${sopInstanceUID.substring(0, 20)}...`);
      return this.connectionQueue.enqueue(() => this.retrieveWithCMove(studyInstanceUID, seriesInstanceUID, sopInstanceUID));
    }

    // C-GET: retrieve directly to this client
    console.log(`[${timestamp}] Queueing C-GET request for ${sopInstanceUID.substring(0, 20)}...`);
    return this.connectionQueue.enqueue(() => this.retrieveWithCGet(studyInstanceUID, seriesInstanceUID, sopInstanceUID));
  }

  /**
   * Retrieve using C-GET - retrieves directly to this client
   */
  private async retrieveWithCGet(
    studyInstanceUID: string,
    seriesInstanceUID?: string,
    sopInstanceUID?: string
  ): Promise<RetrieveResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DimseDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = seriesInstanceUID
        ? sopInstanceUID
          ? CGetRequest.createImageGetRequest(
              studyInstanceUID,
              seriesInstanceUID,
              sopInstanceUID
            )
          : CGetRequest.createSeriesGetRequest(
              studyInstanceUID,
              seriesInstanceUID
            )
        : CGetRequest.createStudyGetRequest(studyInstanceUID);

      (request as any).on("response", (response: any) => {
        if (response.getStatus() === Status.Pending) {
          failed = response.getFailures?.() || 0;
          warnings = response.getWarnings?.() || 0;
        } else if (response.getStatus() === Status.Success) {
          completed = true;
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
        }
      });

      // C-GET sends datasets directly to this client via C-STORE
      (client as any).on(
        "cStoreRequest",
        (storeRequest: any, callback: Function) => {
          if (storeRequest.hasDataset && storeRequest.hasDataset()) {
            const dataset = storeRequest.getDataset();
            if (dataset) {
              results.push(dataset);
            }
          }

          const storeResponse = CStoreResponse.fromRequest(storeRequest);
          storeResponse.setStatus(Status.Success);
          callback(storeResponse);
        }
      );

      (client as any).on("closed", () => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        }
      });

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
      });

      client.addRequest(request);
      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  /**
   * Retrieve study using C-MOVE with SCP server integration
   */
  private async retrieveWithCMove(
    studyInstanceUID: string,
    seriesInstanceUID?: string,
    sopInstanceUID?: string
  ): Promise<RetrieveResult> {
    if (!this.requestTracker) {
      throw new Error("Request tracker not available for C-MOVE operations");
    }

    const peer = this.getAvailablePeer();
    
    try {
      // Register the request with the tracker to expect incoming C-STORE
      const { correlationId, promise } = await this.requestTracker.registerCMoveRequest(
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID
      );

      console.log(`Registered C-MOVE request ${correlationId} for Study: ${studyInstanceUID}`);

      // Send the C-MOVE request to the PACS
      const client = new Client();
      let moveCompleted = false;
      let failed = 0;
      let warnings = 0;
      let expectedInstancesSet = false;

      const sendCMoveRequest = new Promise<void>((resolve, reject) => {
        const request = seriesInstanceUID
          ? sopInstanceUID
            ? CMoveRequest.createImageMoveRequest(
                this.config!.proxyServer.aet,
                studyInstanceUID,
                seriesInstanceUID,
                sopInstanceUID
              )
            : CMoveRequest.createSeriesMoveRequest(
                this.config!.proxyServer.aet,
                studyInstanceUID,
                seriesInstanceUID
              )
          : CMoveRequest.createStudyMoveRequest(
              this.config!.proxyServer.aet,
              studyInstanceUID
            );

        let requestError: string | undefined;

        (request as any).on("response", (response: any) => {
          if (response.getStatus() === Status.Pending) {
            failed = response.getFailures?.() || 0;
            warnings = response.getWarnings?.() || 0;

            // Extract the number of remaining and completed operations to determine total expected
            const remaining = response.getRemaining?.() || 0;
            const completed = response.getCompleted?.() || 0;
            const totalExpected = remaining + completed + failed + warnings;

            // Set expected instances on first Pending response
            if (!expectedInstancesSet && totalExpected > 0) {
              this.requestTracker!.setExpectedInstances(correlationId, totalExpected);
              expectedInstancesSet = true;
            }

            console.log(`C-MOVE progress - Remaining: ${remaining}, Completed: ${completed}, Failed: ${failed}, Warnings: ${warnings}`);
          } else if (response.getStatus() === Status.Success) {
            console.log(`C-MOVE request completed successfully for ${correlationId}`);
            moveCompleted = true;

            // If we never got a Pending response with counts, set expected to 1 (single instance case)
            if (!expectedInstancesSet) {
              const finalCompleted = response.getCompleted?.() || 1;
              const finalFailed = response.getFailures?.() || 0;
              const finalWarnings = response.getWarnings?.() || 0;
              const totalExpected = finalCompleted + finalFailed + finalWarnings;
              this.requestTracker!.setExpectedInstances(correlationId, totalExpected);
              expectedInstancesSet = true;
            }
          } else {
            requestError = `C-MOVE request failed with status: ${response.getStatus()}`;
            console.error(requestError);
          }
        });

        (client as any).on("closed", () => {
          if (requestError) {
            reject(new Error(requestError));
          } else {
            // C-MOVE connection closed - mark as completed to unblock any waiting C-STORE collections
            // This handles cases where not all expected C-STOREs arrived
            if (this.requestTracker && moveCompleted) {
              this.requestTracker.markCMoveCompleted(correlationId);
            }
            resolve();
          }
        });

        (client as any).on("networkError", (e: Error) => {
          requestError = `C-MOVE network error: ${e.message}`;
          console.error(requestError);
        });

        client.addRequest(request);
        client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
      });

      // Wait for both the C-MOVE to complete and the C-STORE datasets to be received
      // const [, datasets] = await Promise.all([sendCMoveRequest, promise]);
      await sendCMoveRequest;
      const datasets = await promise;

      return {
        datasets,
        completed: moveCompleted,
        failed,
        warnings,
      };

    } catch (error) {
      console.error('C-MOVE operation failed:', error);
      return {
        datasets: [],
        completed: false,
        failed: 1,
        warnings: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private getAvailablePeer(): { aet: string; ip: string; port: number } {
    if (!this.config?.peers || this.config.peers.length === 0) {
      throw new Error("No DIMSE peers configured");
    }
    return this.config.peers[0]!;
  }

  public async echo(peer?: {
    aet: string;
    ip: string;
    port: number;
  }): Promise<boolean> {
    // Queue the request to limit concurrent connections
    return this.connectionQueue.enqueue(() => this.executeEcho(peer));
  }

  private async executeEcho(peer?: {
    aet: string;
    ip: string;
    port: number;
  }): Promise<boolean> {
    const targetPeer = peer || this.getAvailablePeer();
    const client = new Client();

    return new Promise((resolve, reject) => {
      const request = new CEchoRequest();
      let echoSuccess = false;
      let error: string | undefined;

      (request as any).on("response", (response: IResponses.CEchoResponse) => {
        echoSuccess = response.getStatus() === Status.Success;
      });

      (client as any).on("closed", () => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(echoSuccess);
        }
      });

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
      });

      client.addRequest(request);
      client.send(
        targetPeer.ip,
        targetPeer.port,
        this.config!.proxyServer.aet,
        targetPeer.aet
      );
    });
  }
}
