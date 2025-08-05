import { IncomingMessage, ServerResponse } from "node:http";
import type { Buffer } from "node:buffer";

export interface ProxyConfig {
  proxyMode: "dimse" | "dicomweb";
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
  enableCache: boolean;
  webserverPort: number;
  useCget: boolean;
  useFetchLevel: "PATIENT" | "STUDY" | "SERIES" | "INSTANCE";
  maxAssociations: number;
  qidoMinChars: number;
  qidoAppendWildcard: boolean;
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
  requestType?: "WADO-URI" | "WADO-RS";
  accept?: string;
  contentType?: string;
  charset?: string;
  frameNumber?: number;
  transferSyntax?: string;
  multipart?: boolean;
}

export interface RequestHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
}

export interface MiddlewareFunction {
  (req: IncomingMessage, res: ServerResponse, next: () => void): void;
}

// Import Dataset class from dcmjs-dimse for proper typing
export type DimseDataset = import("dcmjs-dimse").Dataset;

// DICOM element structure based on dcmjs format
export interface DicomElement {
  vr?: string;
  Value?: any[];
  InlineBinary?: ArrayBuffer;
  BulkDataURI?: string;
  [key: string]: any;
}

// DICOM elements collection
export interface DicomElements {
  [tag: string]: DicomElement;
}

// Legacy type for backward compatibility
export interface DicomDataset {
  [key: string]: any;
}

// DICOMweb JSON format with hex tag keys
interface DicomWebElement {
  vr: string;
  Value?: any[];
  InlineBinary?: string;
  BulkDataURI?: string;
  [key: string]: any;
}

export interface DicomWebJson {
  [hexTag: string]: DicomWebElement;
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
