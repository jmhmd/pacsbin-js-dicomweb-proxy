import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { ProxyConfig, QidoQuery, RequestHandler } from '../types';
import { DimseClient } from '../dimse/client';
import { DicomWebTranslator } from '../dimse/translator';

export class QidoHandler {
  private config: ProxyConfig;
  private dimseClient: DimseClient;

  constructor(config: ProxyConfig) {
    this.config = config;
    
    if (config.proxyMode === 'dimse' && config.dimseProxySettings) {
      this.dimseClient = new DimseClient(config.dimseProxySettings);
    } else {
      throw new Error('QIDO handler requires DIMSE proxy mode');
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
        
        if (pathParts.length === 1) {
          await this.handleStudiesQuery(req, res, query);
        } else if (pathParts.length === 3 && pathParts[2] === 'series') {
          await this.handleSeriesQuery(req, res, pathParts[1]!, query);
        } else if (pathParts.length === 5 && pathParts[2] === 'series' && pathParts[4] === 'instances') {
          await this.handleInstancesQuery(req, res, pathParts[1]!, pathParts[3]!, query);
        } else {
          this.sendError(res, 404, 'Not Found');
        }
      } catch (error) {
        console.error('QIDO handler error:', error);
        this.sendError(res, 500, 'Internal Server Error');
      }
    };
  }

  private parseQuery(searchParams: URLSearchParams): QidoQuery {
    const query: QidoQuery = {};

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
        case 'PatientName':
          query.patientName = DicomWebTranslator.applyWildcardMatching(
            value, 
            this.config.qidoMinChars, 
            this.config.qidoAppendWildcard
          );
          break;
        case 'PatientID':
          query.patientID = DicomWebTranslator.applyWildcardMatching(
            value, 
            this.config.qidoMinChars, 
            this.config.qidoAppendWildcard
          );
          break;
        case 'AccessionNumber':
          query.accessionNumber = value;
          break;
        case 'StudyDate':
          query.studyDate = DicomWebTranslator.convertToDicomDate(value);
          break;
        case 'StudyTime':
          query.studyTime = DicomWebTranslator.convertToDicomTime(value);
          break;
        case 'ModalitiesInStudy':
          query.modalitiesInStudy = value;
          break;
        case 'InstitutionName':
          query.institutionName = value;
          break;
        case 'limit':
          query.limit = parseInt(value, 10);
          break;
        case 'offset':
          query.offset = parseInt(value, 10);
          break;
        case 'includefield':
          query.includefield = value;
          break;
        case 'fuzzymatching':
          query.fuzzymatching = value.toLowerCase() === 'true';
          break;
      }
    }

    return query;
  }

  private async handleStudiesQuery(_req: IncomingMessage, res: ServerResponse, query: QidoQuery): Promise<void> {
    const dataset = DicomWebTranslator.createQueryDataset(query);
    
    const result = await this.dimseClient.findStudies(dataset);
    
    if (result.error) {
      this.sendError(res, 500, `DIMSE query failed: ${result.error}`);
      return;
    }

    const studies = result.datasets.map(ds => DicomWebTranslator.datasetToStudy(ds));
    
    let filteredStudies = studies;
    if (query.limit) {
      const offset = query.offset || 0;
      filteredStudies = studies.slice(offset, offset + query.limit);
    }

    this.sendJsonResponse(res, filteredStudies);
  }

  private async handleSeriesQuery(_req: IncomingMessage, res: ServerResponse, studyInstanceUID: string, query: QidoQuery): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, 'Invalid StudyInstanceUID');
      return;
    }

    const dataset = DicomWebTranslator.createQueryDataset({
      ...query,
      studyInstanceUID
    });

    const result = await this.dimseClient.findSeries(dataset);
    
    if (result.error) {
      this.sendError(res, 500, `DIMSE query failed: ${result.error}`);
      return;
    }

    const series = result.datasets.map(ds => DicomWebTranslator.datasetToSeries(ds));
    
    let filteredSeries = series;
    if (query.limit) {
      const offset = query.offset || 0;
      filteredSeries = series.slice(offset, offset + query.limit);
    }

    this.sendJsonResponse(res, filteredSeries);
  }

  private async handleInstancesQuery(_req: IncomingMessage, res: ServerResponse, studyInstanceUID: string, seriesInstanceUID: string, query: QidoQuery): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, 'Invalid StudyInstanceUID');
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      this.sendError(res, 400, 'Invalid SeriesInstanceUID');
      return;
    }

    const dataset = DicomWebTranslator.createQueryDataset({
      ...query,
      studyInstanceUID,
      seriesInstanceUID
    });

    const result = await this.dimseClient.findInstances(dataset);
    
    if (result.error) {
      this.sendError(res, 500, `DIMSE query failed: ${result.error}`);
      return;
    }

    const instances = result.datasets.map(ds => DicomWebTranslator.datasetToInstance(ds));
    
    let filteredInstances = instances;
    if (query.limit) {
      const offset = query.offset || 0;
      filteredInstances = instances.slice(offset, offset + query.limit);
    }

    this.sendJsonResponse(res, filteredInstances);
  }

  private sendJsonResponse(res: ServerResponse, data: any): void {
    const jsonResponse = DicomWebTranslator.createDicomWebResponse(data);
    
    res.writeHead(200, {
      'Content-Type': 'application/dicom+json; charset=utf-8',
      'Content-Length': Buffer.byteLength(jsonResponse),
      'Cache-Control': 'no-cache',
    });
    
    res.end(jsonResponse);
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