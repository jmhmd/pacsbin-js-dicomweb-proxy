import DcmjsDimse from "dcmjs-dimse";
import type { responses as IResponses } from "dcmjs-dimse";
import { ProxyConfig, DicomDataset, DimseDataset } from "../types";
import { CMoveRequestTracker } from "./request-tracker";

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

export class DimseClient {
  private config: ProxyConfig["dimseProxySettings"];
  private requestTracker?: CMoveRequestTracker | undefined;

  constructor(
    config: ProxyConfig["dimseProxySettings"], 
    requestTracker?: CMoveRequestTracker | undefined
  ) {
    if (!config) {
      throw new Error("DIMSE proxy settings are required");
    }
    this.config = config;
    this.requestTracker = requestTracker;
  }

  public async findStudies(query: DicomDataset): Promise<FindResult> {
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
          resolve({
            datasets: results,
            completed,
            error,
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            error,
          });
        }
      });

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async findSeries(query: DicomDataset): Promise<FindResult> {
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
          resolve({
            datasets: results,
            completed,
            error,
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            error,
          });
        }
      });

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async findInstances(query: DicomDataset): Promise<FindResult> {
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
          resolve({
            datasets: results,
            completed,
            error,
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            error,
          });
        }
      });

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveStudy(
    studyInstanceUID: string,
    useCGet: boolean = false
  ): Promise<RetrieveResult> {
    const peer = this.getAvailablePeer();
    
    // Handle C-MOVE with SCP server
    if (!useCGet && this.requestTracker) {
      return this.retrieveWithCMove(studyInstanceUID);
    }

    // Handle C-GET (direct client-to-client transfer)
    const client = new Client();
    const results: DimseDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = useCGet
        ? CGetRequest.createStudyGetRequest(studyInstanceUID)
        : CMoveRequest.createStudyMoveRequest(
            this.config!.proxyServer.aet,
            studyInstanceUID
          );

      (request as any).on("response", (response: any) => {
        if (response.getStatus() === Status.Pending) {
          failed = response.getFailures?.() || 0;
          warnings = response.getWarnings?.() || 0;
        } else if (response.getStatus() === Status.Success) {
          completed = true;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        }
      });

      if (useCGet) {
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
      }

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveSeries(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    useCGet: boolean = false
  ): Promise<RetrieveResult> {
    // Handle C-MOVE with SCP server
    if (!useCGet && this.requestTracker) {
      return this.retrieveWithCMove(studyInstanceUID, seriesInstanceUID);
    }
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DimseDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = useCGet
        ? CGetRequest.createSeriesGetRequest(
            studyInstanceUID,
            seriesInstanceUID
          )
        : CMoveRequest.createSeriesMoveRequest(
            this.config!.proxyServer.aet,
            studyInstanceUID,
            seriesInstanceUID
          );

      (request as any).on("response", (response: any) => {
        if (response.getStatus() === Status.Pending) {
          failed = response.getFailures?.() || 0;
          warnings = response.getWarnings?.() || 0;
        } else if (response.getStatus() === Status.Success) {
          completed = true;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        }
      });

      if (useCGet) {
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
      }

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveInstance(
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    useCGet: boolean = false
  ): Promise<RetrieveResult> {
    // Handle C-MOVE with SCP server
    if (!useCGet && this.requestTracker) {
      return this.retrieveWithCMove(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    }
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DimseDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = useCGet
        ? CGetRequest.createImageGetRequest(
            studyInstanceUID,
            seriesInstanceUID,
            sopInstanceUID
          )
        : CMoveRequest.createImageMoveRequest(
            this.config!.proxyServer.aet,
            studyInstanceUID,
            seriesInstanceUID,
            sopInstanceUID
          );

      (request as any).on("response", (response: any) => {
        if (response.getStatus() === Status.Pending) {
          failed = response.getFailures?.() || 0;
          warnings = response.getWarnings?.() || 0;
        } else if (response.getStatus() === Status.Success) {
          completed = true;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error,
          });
        }
      });

      if (useCGet) {
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
      }

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

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

        (request as any).on("response", (response: any) => {
          if (response.getStatus() === Status.Pending) {
            failed = response.getFailures?.() || 0;
            warnings = response.getWarnings?.() || 0;
            console.log(`C-MOVE progress - Failed: ${failed}, Warnings: ${warnings}`);
          } else if (response.getStatus() === Status.Success) {
            console.log(`C-MOVE request completed successfully for ${correlationId}`);
            moveCompleted = true;
            resolve();
          } else {
            const error = `C-MOVE request failed with status: ${response.getStatus()}`;
            console.error(error);
            reject(new Error(error));
          }
        });

        client.addRequest(request);

        (client as any).on("networkError", (e: Error) => {
          const error = `C-MOVE network error: ${e.message}`;
          console.error(error);
          reject(new Error(error));
        });

        client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
      });

      // Wait for both the C-MOVE to complete and the C-STORE datasets to be received
      const [, datasets] = await Promise.all([sendCMoveRequest, promise]);

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
    const targetPeer = peer || this.getAvailablePeer();
    const client = new Client();

    return new Promise((resolve, reject) => {
      const request = new CEchoRequest();

      (request as any).on("response", (response: IResponses.CEchoResponse) => {
        resolve(response.getStatus() === Status.Success);
      });

      client.addRequest(request);

      (client as any).on("networkError", (e: Error) => {
        reject(new Error(`Network error: ${e.message}`));
      });

      client.send(
        targetPeer.ip,
        targetPeer.port,
        this.config!.proxyServer.aet,
        targetPeer.aet
      );
    });
  }
}
