import { Client, requests, responses, constants } from 'dcmjs-dimse';
import { ProxyConfig, DicomDataset } from '../types';

const { CFindRequest, CGetRequest, CMoveRequest, CEchoRequest } = requests;
const { CStoreResponse } = responses;
const { Status } = constants;

export interface FindResult {
  datasets: DicomDataset[];
  completed: boolean;
  error?: string | undefined;
}

export interface RetrieveResult {
  datasets: DicomDataset[];
  completed: boolean;
  failed: number;
  warnings: number;
  error?: string | undefined;
}

export class DimseClient {
  private config: ProxyConfig['dimseProxySettings'];

  constructor(config: ProxyConfig['dimseProxySettings']) {
    if (!config) {
      throw new Error('DIMSE proxy settings are required');
    }
    this.config = config;
  }

  public async findStudies(query: DicomDataset): Promise<FindResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = CFindRequest.createStudyFindRequest(query);
      
      (request as any).on('response', (response: responses.CFindResponse) => {
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
            error
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            error
          });
        }
      });

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
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
      
      (request as any).on('response', (response: responses.CFindResponse) => {
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
            error
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            error
          });
        }
      });

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
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
      
      (request as any).on('response', (response: responses.CFindResponse) => {
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
            error
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Find request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            error
          });
        }
      });

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveStudy(studyInstanceUID: string, useCGet: boolean = false): Promise<RetrieveResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = useCGet 
        ? CGetRequest.createStudyGetRequest(studyInstanceUID)
        : CMoveRequest.createStudyMoveRequest(this.config!.proxyServer.aet, studyInstanceUID);

      (request as any).on('response', (response: any) => {
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
            error
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error
          });
        }
      });

      if (useCGet) {
        (client as any).on('cStoreRequest', (storeRequest: any, callback: Function) => {
          if (storeRequest.hasDataset && storeRequest.hasDataset()) {
            const dataset = storeRequest.getDataset();
            if (dataset) {
              results.push(dataset);
            }
          }
          
          const storeResponse = CStoreResponse.fromRequest(storeRequest);
          storeResponse.setStatus(Status.Success);
          callback(storeResponse);
        });
      }

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveSeries(studyInstanceUID: string, seriesInstanceUID: string, useCGet: boolean = false): Promise<RetrieveResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = useCGet 
        ? CGetRequest.createSeriesGetRequest(studyInstanceUID, seriesInstanceUID)
        : CMoveRequest.createSeriesMoveRequest(this.config!.proxyServer.aet, studyInstanceUID, seriesInstanceUID);

      (request as any).on('response', (response: any) => {
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
            error
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error
          });
        }
      });

      if (useCGet) {
        (client as any).on('cStoreRequest', (storeRequest: any, callback: Function) => {
          if (storeRequest.hasDataset && storeRequest.hasDataset()) {
            const dataset = storeRequest.getDataset();
            if (dataset) {
              results.push(dataset);
            }
          }
          
          const storeResponse = CStoreResponse.fromRequest(storeRequest);
          storeResponse.setStatus(Status.Success);
          callback(storeResponse);
        });
      }

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  public async retrieveInstance(studyInstanceUID: string, seriesInstanceUID: string, sopInstanceUID: string, useCGet: boolean = false): Promise<RetrieveResult> {
    const peer = this.getAvailablePeer();
    const client = new Client();
    const results: DicomDataset[] = [];
    let completed = false;
    let failed = 0;
    let warnings = 0;
    let error: string | undefined;

    return new Promise((resolve, reject) => {
      const request = useCGet 
        ? CGetRequest.createImageGetRequest(studyInstanceUID, seriesInstanceUID, sopInstanceUID)
        : CMoveRequest.createImageMoveRequest(this.config!.proxyServer.aet, studyInstanceUID, seriesInstanceUID, sopInstanceUID);

      (request as any).on('response', (response: any) => {
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
            error
          });
        } else if (response.getStatus() !== Status.Pending) {
          error = `Retrieve request failed with status: ${response.getStatus()}`;
          resolve({
            datasets: results,
            completed,
            failed,
            warnings,
            error
          });
        }
      });

      if (useCGet) {
        (client as any).on('cStoreRequest', (storeRequest: any, callback: Function) => {
          if (storeRequest.hasDataset && storeRequest.hasDataset()) {
            const dataset = storeRequest.getDataset();
            if (dataset) {
              results.push(dataset);
            }
          }
          
          const storeResponse = CStoreResponse.fromRequest(storeRequest);
          storeResponse.setStatus(Status.Success);
          callback(storeResponse);
        });
      }

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
        error = `Network error: ${e.message}`;
        reject(new Error(error));
      });

      client.send(peer.ip, peer.port, this.config!.proxyServer.aet, peer.aet);
    });
  }

  private getAvailablePeer(): { aet: string; ip: string; port: number } {
    if (!this.config?.peers || this.config.peers.length === 0) {
      throw new Error('No DIMSE peers configured');
    }
    return this.config.peers[0]!;
  }

  public async echo(peer?: { aet: string; ip: string; port: number }): Promise<boolean> {
    const targetPeer = peer || this.getAvailablePeer();
    const client = new Client();
    
    return new Promise((resolve, reject) => {
      const request = new CEchoRequest();
      
      (request as any).on('response', (response: responses.CEchoResponse) => {
        resolve(response.getStatus() === Status.Success);
      });

      client.addRequest(request);
      
      (client as any).on('networkError', (e: Error) => {
        reject(new Error(`Network error: ${e.message}`));
      });

      client.send(targetPeer.ip, targetPeer.port, this.config!.proxyServer.aet, targetPeer.aet);
    });
  }
}