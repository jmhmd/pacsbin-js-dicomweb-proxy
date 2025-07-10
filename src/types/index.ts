import { IncomingMessage, ServerResponse } from 'http';

export interface ProxyConfig {
  proxyMode: 'dimse' | 'dicomweb';
  dicomwebProxySettings?: {
    qidoForwardingUrl: string;
    wadoForwardingUrl: string;
  };
  dimseProxySettings?: {
    proxyServer: {
      aet: string;
      ip: string;
      port: number;
    };
    peers: Array<{
      aet: string;
      ip: string;
      port: number;
    }>;
  };
  logDir: string;
  storagePath: string;
  cacheRetentionMinutes: number;
  webserverPort: number;
  useCget: boolean;
  useFetchLevel: 'PATIENT' | 'STUDY' | 'SERIES' | 'INSTANCE';
  maxAssociations: number;
  qidoMinChars: number;
  qidoAppendWildcard: boolean;
  verboseLogging: boolean;
  ssl: {
    enabled: boolean;
    port: number;
    certPath: string;
    keyPath: string;
    generateSelfSigned: boolean;
    redirectHttp: boolean;
  };
  cors: {
    origin: string[];
    methods: string[];
    allowedHeaders: string[];
    credentials: boolean;
  };
}

export interface DimseConnection {
  aet: string;
  ip: string;
  port: number;
  connected: boolean;
  lastUsed: Date;
}

export interface CacheEntry {
  path: string;
  size: number;
  created: Date;
  accessed: Date;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
}

export interface QidoQuery {
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  patientName?: string;
  patientID?: string;
  accessionNumber?: string;
  studyDate?: string;
  studyTime?: string;
  modalitiesInStudy?: string;
  institutionName?: string;
  limit?: number;
  offset?: number;
  includefield?: string;
  fuzzymatching?: boolean;
}

export interface WadoQuery {
  studyInstanceUID: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  requestType?: 'WADO-URI' | 'WADO-RS';
  accept?: string;
  contentType?: string;
  charset?: string;
  anonymize?: string;
  annotation?: string;
  rows?: number;
  columns?: number;
  region?: string;
  windowCenter?: number;
  windowWidth?: number;
  frameNumber?: number;
  imageQuality?: number;
  presentationUID?: string;
  presentationSeriesUID?: string;
  transferSyntax?: string;
}

export interface DicomWebResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
  contentType: string;
}

export interface RequestHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export interface MiddlewareFunction {
  (req: IncomingMessage, res: ServerResponse, next: () => void): void;
}

export interface LogContext {
  requestId: string;
  method: string;
  url: string;
  userAgent?: string;
  remoteAddress?: string;
  timestamp: Date;
}

export interface DicomDataset {
  [key: string]: any;
}

export interface DicomWebStudy {
  StudyInstanceUID: string;
  StudyDate?: string;
  StudyTime?: string;
  AccessionNumber?: string;
  ReferringPhysicianName?: string;
  PatientName?: string;
  PatientID?: string;
  PatientBirthDate?: string;
  PatientSex?: string;
  StudyDescription?: string;
  ModalitiesInStudy?: string[] | undefined;
  NumberOfStudyRelatedSeries?: number;
  NumberOfStudyRelatedInstances?: number;
}

export interface DicomWebSeries {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SeriesDate?: string;
  SeriesTime?: string;
  Modality?: string;
  SeriesDescription?: string;
  SeriesNumber?: number;
  NumberOfSeriesRelatedInstances?: number;
  BodyPartExamined?: string;
  ProtocolName?: string;
  OperatorsName?: string;
}

export interface DicomWebInstance {
  StudyInstanceUID: string;
  SeriesInstanceUID: string;
  SOPInstanceUID: string;
  SOPClassUID?: string;
  InstanceNumber?: number;
  ContentDate?: string;
  ContentTime?: string;
  NumberOfFrames?: number;
  Rows?: number;
  Columns?: number;
  BitsAllocated?: number;
  BitsStored?: number;
  HighBit?: number;
  PixelRepresentation?: number;
  PhotometricInterpretation?: string;
  TransferSyntaxUID?: string;
}

export interface ServerStats {
  startTime: Date;
  requestCount: number;
  errorCount: number;
  cacheHits: number;
  cacheMisses: number;
  activeConnections: number;
  totalConnections: number;
  bytesServed: number;
  averageResponseTime: number;
}

export interface RouteMatch {
  handler: RequestHandler;
  params: Record<string, string>;
}

export interface Route {
  method: string;
  path: string;
  handler: RequestHandler;
  pathRegex: RegExp;
  paramNames: string[];
}