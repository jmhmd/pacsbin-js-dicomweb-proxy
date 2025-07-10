import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { ProxyConfig, WadoQuery, RequestHandler } from '../types';
import { DimseClient } from '../dimse/client';
import { DicomWebTranslator } from '../dimse/translator';
import { FileCache } from '../cache/file-cache';

export class WadoHandler {
  private config: ProxyConfig;
  private dimseClient: DimseClient;
  private cache: FileCache;

  constructor(config: ProxyConfig, cache: FileCache) {
    this.config = config;
    this.cache = cache;
    
    if (config.proxyMode === 'dimse' && config.dimseProxySettings) {
      this.dimseClient = new DimseClient(config.dimseProxySettings);
    } else {
      throw new Error('WADO handler requires DIMSE proxy mode');
    }
  }

  public getHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const pathParts = url.pathname.split('/').filter(part => part);
        
        if (pathParts.length < 2 || pathParts[0] !== 'studies') {
          this.sendError(res, 404, 'Not Found');
          return;
        }

        const query = this.parseQuery(url.searchParams);
        
        if (pathParts.length === 2) {
          await this.handleStudyRetrieval(req, res, pathParts[1]!, query);
        } else if (pathParts.length === 4 && pathParts[2] === 'series') {
          await this.handleSeriesRetrieval(req, res, pathParts[1]!, pathParts[3]!, query);
        } else if (pathParts.length === 6 && pathParts[2] === 'series' && pathParts[4] === 'instances') {
          await this.handleInstanceRetrieval(req, res, pathParts[1]!, pathParts[3]!, pathParts[5]!, query);
        } else {
          this.sendError(res, 404, 'Not Found');
        }
      } catch (error) {
        console.error('WADO handler error:', error);
        this.sendError(res, 500, 'Internal Server Error');
      }
    };
  }

  private parseQuery(searchParams: URLSearchParams): WadoQuery {
    const query: WadoQuery = {
      studyInstanceUID: '',
      requestType: 'WADO-RS'
    };

    for (const [key, value] of searchParams) {
      switch (key) {
        case 'StudyInstanceUID':
          query.studyInstanceUID = value;
          break;
        case 'SeriesInstanceUID':
          query.seriesInstanceUID = value;
          break;
        case 'SOPInstanceUID':
          query.sopInstanceUID = value;
          break;
        case 'requestType':
          query.requestType = value as 'WADO-URI' | 'WADO-RS';
          break;
        case 'accept':
          query.accept = value;
          break;
        case 'contentType':
          query.contentType = value;
          break;
        case 'charset':
          query.charset = value;
          break;
        case 'anonymize':
          query.anonymize = value;
          break;
        case 'annotation':
          query.annotation = value;
          break;
        case 'rows':
          query.rows = parseInt(value, 10);
          break;
        case 'columns':
          query.columns = parseInt(value, 10);
          break;
        case 'region':
          query.region = value;
          break;
        case 'windowCenter':
          query.windowCenter = parseInt(value, 10);
          break;
        case 'windowWidth':
          query.windowWidth = parseInt(value, 10);
          break;
        case 'frameNumber':
          query.frameNumber = parseInt(value, 10);
          break;
        case 'imageQuality':
          query.imageQuality = parseInt(value, 10);
          break;
        case 'presentationUID':
          query.presentationUID = value;
          break;
        case 'presentationSeriesUID':
          query.presentationSeriesUID = value;
          break;
        case 'transferSyntax':
          query.transferSyntax = value;
          break;
      }
    }

    return query;
  }

  private async handleStudyRetrieval(_req: IncomingMessage, res: ServerResponse, studyInstanceUID: string, query: WadoQuery): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, 'Invalid StudyInstanceUID');
      return;
    }

    query.studyInstanceUID = studyInstanceUID;

    const cached = await this.cache.has(studyInstanceUID);
    if (cached) {
      const cachedData = await this.cache.retrieve(studyInstanceUID);
      if (cachedData) {
        this.sendDicomResponse(res, cachedData, true);
        return;
      }
    }

    const result = await this.dimseClient.retrieveStudy(studyInstanceUID, this.config.useCget);
    
    if (result.error) {
      this.sendError(res, 500, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      this.sendError(res, 404, 'Study not found');
      return;
    }

    const instances: Buffer[] = [];
    for (const dataset of result.datasets) {
      const instanceBuffer = await this.datasetToBuffer(dataset);
      instances.push(instanceBuffer);
      
      await this.cache.store(
        studyInstanceUID,
        dataset['SeriesInstanceUID'] || '',
        dataset['SOPInstanceUID'] || '',
        instanceBuffer
      );
    }

    if (instances.length === 1) {
      const instance = instances[0];
      if (instance) {
        this.sendDicomResponse(res, instance, false);
      } else {
        this.sendError(res, 500, 'Failed to retrieve instance data');
      }
    } else {
      this.sendMultipartResponse(res, instances);
    }
  }

  private async handleSeriesRetrieval(_req: IncomingMessage, res: ServerResponse, studyInstanceUID: string, seriesInstanceUID: string, query: WadoQuery): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, 'Invalid StudyInstanceUID');
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      this.sendError(res, 400, 'Invalid SeriesInstanceUID');
      return;
    }

    query.studyInstanceUID = studyInstanceUID;
    query.seriesInstanceUID = seriesInstanceUID;

    const cached = await this.cache.has(studyInstanceUID, seriesInstanceUID);
    if (cached) {
      const cachedData = await this.cache.retrieve(studyInstanceUID, seriesInstanceUID);
      if (cachedData) {
        this.sendDicomResponse(res, cachedData, true);
        return;
      }
    }

    const result = await this.dimseClient.retrieveSeries(studyInstanceUID, seriesInstanceUID, this.config.useCget);
    
    if (result.error) {
      this.sendError(res, 500, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      this.sendError(res, 404, 'Series not found');
      return;
    }

    const instances: Buffer[] = [];
    for (const dataset of result.datasets) {
      const instanceBuffer = await this.datasetToBuffer(dataset);
      instances.push(instanceBuffer);
      
      await this.cache.store(
        studyInstanceUID,
        seriesInstanceUID,
        dataset['SOPInstanceUID'] || '',
        instanceBuffer
      );
    }

    if (instances.length === 1) {
      const instance = instances[0];
      if (instance) {
        this.sendDicomResponse(res, instance, false);
      } else {
        this.sendError(res, 500, 'Failed to retrieve instance data');
      }
    } else {
      this.sendMultipartResponse(res, instances);
    }
  }

  private async handleInstanceRetrieval(_req: IncomingMessage, res: ServerResponse, studyInstanceUID: string, seriesInstanceUID: string, sopInstanceUID: string, query: WadoQuery): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, 'Invalid StudyInstanceUID');
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      this.sendError(res, 400, 'Invalid SeriesInstanceUID');
      return;
    }

    if (!DicomWebTranslator.validateSOPInstanceUID(sopInstanceUID)) {
      this.sendError(res, 400, 'Invalid SOPInstanceUID');
      return;
    }

    query.studyInstanceUID = studyInstanceUID;
    query.seriesInstanceUID = seriesInstanceUID;
    query.sopInstanceUID = sopInstanceUID;

    const cached = await this.cache.has(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
    if (cached) {
      const cachedData = await this.cache.retrieve(studyInstanceUID, seriesInstanceUID, sopInstanceUID);
      if (cachedData) {
        this.sendDicomResponse(res, cachedData, true);
        return;
      }
    }

    const result = await this.dimseClient.retrieveInstance(studyInstanceUID, seriesInstanceUID, sopInstanceUID, this.config.useCget);
    
    if (result.error) {
      this.sendError(res, 500, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      this.sendError(res, 404, 'Instance not found');
      return;
    }

    const dataset = result.datasets[0];
    if (!dataset) {
      this.sendError(res, 404, 'Instance data not found');
      return;
    }
    
    const instanceBuffer = await this.datasetToBuffer(dataset);
    
    await this.cache.store(studyInstanceUID, seriesInstanceUID, sopInstanceUID, instanceBuffer);
    
    this.sendDicomResponse(res, instanceBuffer, false);
  }

  private async datasetToBuffer(dataset: any): Promise<Buffer> {
    try {
      const { Dataset } = require('dcmjs-dimse');
      if (dataset instanceof Dataset) {
        return Buffer.from(dataset.getDenaturalizedDataset());
      }
      
      return Buffer.from(JSON.stringify(dataset));
    } catch (error) {
      console.error('Error converting dataset to buffer:', error);
      return Buffer.from('');
    }
  }

  private sendDicomResponse(res: ServerResponse, data: Buffer, fromCache: boolean): void {
    const headers: Record<string, string> = {
      'Content-Type': 'application/dicom',
      'Content-Length': data.length.toString(),
      'Cache-Control': fromCache ? 'max-age=3600' : 'no-cache',
    };

    if (fromCache) {
      headers['X-Cache'] = 'HIT';
    } else {
      headers['X-Cache'] = 'MISS';
    }

    res.writeHead(200, headers);
    res.end(data);
  }

  private sendMultipartResponse(res: ServerResponse, instances: Buffer[]): void {
    const boundary = DicomWebTranslator.createMultipartBoundary();
    const multipartData = DicomWebTranslator.createMultipartResponse(instances, boundary);

    res.writeHead(200, {
      'Content-Type': `multipart/related; type="application/dicom"; boundary=${boundary}`,
      'Content-Length': multipartData.length.toString(),
      'Cache-Control': 'no-cache',
      'X-Cache': 'MISS',
    });

    res.end(multipartData);
  }

  private sendError(res: ServerResponse, statusCode: number, message: string): void {
    const errorResponse = {
      error: message,
      statusCode,
      timestamp: new Date().toISOString()
    };
    
    const jsonResponse = JSON.stringify(errorResponse);
    
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(jsonResponse),
    });
    
    res.end(jsonResponse);
  }
}