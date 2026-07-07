import { IncomingMessage, ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import {
  ProxyConfig,
  WadoQuery,
  RequestHandler,
  DimseDataset,
  DicomElements,
} from "../types";
import { DimseClient } from "../dimse/client";
import { DicomWebTranslator } from "../dimse/translator";
import { FileCache } from "../cache/file-cache";
import * as dcmjs from "dcmjs";
import DcmjsDimse from "dcmjs-dimse";
import { sendError } from "../utils/http-response";
import { logger } from "../utils/logger";

const { Dataset, constants, Implementation } = DcmjsDimse;

export class WadoHandler {
  private config: ProxyConfig;
  private dimseClient: DimseClient;
  private cache: FileCache | null;

  // The DimseClient (and its ConnectionQueue) is shared across handlers so
  // maxConcurrentConnections is a proxy-wide cap, not per-handler.
  constructor(
    config: ProxyConfig,
    cache: FileCache | null,
    dimseClient: DimseClient
  ) {
    if (config.proxyMode !== "dimse" || !config.dimseProxySettings) {
      throw new Error("WADO handler requires DIMSE proxy mode");
    }
    this.config = config;
    this.cache = cache;
    this.dimseClient = dimseClient;
  }

  public getHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      // Abort the upstream DIMSE work if the HTTP client disconnects mid-flight
      // so we stop driving a retrieval whose result nobody will read.
      const abortController = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      };
      req.on("close", onClose);

      try {
        const url = new URL(
          req.url || "",
          `http://${req.headers.host || "localhost"}`
        );
        const pathParts = url.pathname.split("/").filter((part) => part);

        if (pathParts.length < 2 || pathParts[0] !== "studies") {
          sendError(res, 404, "Not Found");
          return;
        }

        const query = this.parseQuery(url.searchParams);
        const signal = abortController.signal;

        if (pathParts.length === 2) {
          await this.handleStudyRetrieval(res, pathParts[1]!, query, signal);
        } else if (pathParts.length === 4 && pathParts[2] === "series") {
          await this.handleSeriesRetrieval(
            res,
            pathParts[1]!,
            pathParts[3]!,
            query,
            signal
          );
        } else if (
          pathParts.length === 6 &&
          pathParts[2] === "series" &&
          pathParts[4] === "instances"
        ) {
          await this.handleInstanceRetrieval(
            res,
            pathParts[1]!,
            pathParts[3]!,
            pathParts[5]!,
            query,
            signal
          );
        } else {
          sendError(res, 404, "Not Found");
        }
      } catch (error) {
        const statusCode = (error as any)?.statusCode ?? 500;
        logger.error("WADO handler error", error instanceof Error ? error : new Error(String(error)), {
          method: req.method,
          // Strip the query string to avoid logging PHI-bearing query params;
          // logs are downloadable via /logs/*.
          url: req.url?.split("?")[0],
          userAgent: req.headers['user-agent']
        });
        if (!res.headersSent) {
          sendError(
            res,
            statusCode,
            statusCode === 503 ? "DIMSE proxy busy, please retry" : "Internal Server Error"
          );
        }
      } finally {
        req.off("close", onClose);
      }
    };
  }

  private parseQuery(searchParams: URLSearchParams): WadoQuery {
    const query: WadoQuery = {
      studyInstanceUID: "",
      requestType: "WADO-RS",
    };

    searchParams.forEach((value, key) => {
      switch (key) {
        case "StudyInstanceUID":
          query.studyInstanceUID = value;
          break;
        case "SeriesInstanceUID":
          query.seriesInstanceUID = value;
          break;
        case "SOPInstanceUID":
          query.sopInstanceUID = value;
          break;
        case "requestType":
          query.requestType = value as "WADO-URI" | "WADO-RS";
          break;
        case "accept":
          query.accept = value;
          break;
        case "contentType":
          query.contentType = value;
          break;
        case "frameNumber":
          query.frameNumber = parseInt(value, 10);
          break;
        case "transferSyntax":
          query.transferSyntax = value;
          break;
        case "multipart":
          query.multipart = value.toLowerCase() === "true";
          break;
      }
    });

    return query;
  }

  private async handleStudyRetrieval(
    res: ServerResponse,
    studyInstanceUID: string,
    query: WadoQuery,
    signal: AbortSignal
  ): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      sendError(res, 400, "Invalid StudyInstanceUID");
      return;
    }

    query.studyInstanceUID = studyInstanceUID;

    if (this.cache && this.config.enableCache) {
      const cached = await this.cache.has(studyInstanceUID);
      if (cached) {
        const cachedData = await this.cache.retrieve(studyInstanceUID);
        if (cachedData) {
          this.sendDicomResponse(
            res,
            cachedData,
            true,
            query.multipart !== false
          );
          return;
        }
      }
    }

    const result = await this.dimseClient.retrieveStudy(
      studyInstanceUID,
      this.config.useCget,
      signal
    );

    if (result.error) {
      let statusCode = 500;
      if (result.error.includes("49152")) {
        result.error +=
          " (Likely no study found with this UID, or no matching peers) " +
          "Requested Study Instance UID: " +
          studyInstanceUID;
        statusCode = 404;
      }
      sendError(res, statusCode, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      sendError(res, 404, "Study not found");
      return;
    }

    await this.streamDatasets(res, result.datasets, query, (dataset) => {
      const elements = dataset.getElements();
      return {
        series: (elements["SeriesInstanceUID"] as string) || "",
        sop: (elements["SOPInstanceUID"] as string) || "",
        study: studyInstanceUID,
      };
    });
  }

  private async handleSeriesRetrieval(
    res: ServerResponse,
    studyInstanceUID: string,
    seriesInstanceUID: string,
    query: WadoQuery,
    signal: AbortSignal
  ): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      sendError(res, 400, "Invalid StudyInstanceUID");
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      sendError(res, 400, "Invalid SeriesInstanceUID");
      return;
    }

    query.studyInstanceUID = studyInstanceUID;
    query.seriesInstanceUID = seriesInstanceUID;

    if (this.cache && this.config.enableCache) {
      const cached = await this.cache.has(studyInstanceUID, seriesInstanceUID);
      if (cached) {
        const cachedData = await this.cache.retrieve(
          studyInstanceUID,
          seriesInstanceUID
        );
        if (cachedData) {
          this.sendDicomResponse(
            res,
            cachedData,
            true,
            query.multipart !== false
          );
          return;
        }
      }
    }

    const result = await this.dimseClient.retrieveSeries(
      studyInstanceUID,
      seriesInstanceUID,
      this.config.useCget,
      signal
    );

    if (result.error) {
      let statusCode = 500;
      if (result.error.includes("49152")) {
        result.error +=
          " (Likely no series found with this UID, or no matching peers) " +
          "Requested Series Instance UID: " +
          seriesInstanceUID;
        statusCode = 404;
      }
      sendError(res, statusCode, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      sendError(res, 404, "Series not found");
      return;
    }

    await this.streamDatasets(res, result.datasets, query, (dataset) => {
      const elements = dataset.getElements();
      return {
        series: seriesInstanceUID,
        sop: (elements["SOPInstanceUID"] as string) || "",
        study: studyInstanceUID,
      };
    });
  }

  private async handleInstanceRetrieval(
    res: ServerResponse,
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    query: WadoQuery,
    signal: AbortSignal
  ): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      sendError(res, 400, "Invalid StudyInstanceUID");
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      sendError(res, 400, "Invalid SeriesInstanceUID");
      return;
    }

    if (!DicomWebTranslator.validateSOPInstanceUID(sopInstanceUID)) {
      sendError(res, 400, "Invalid SOPInstanceUID");
      return;
    }

    query.studyInstanceUID = studyInstanceUID;
    query.seriesInstanceUID = seriesInstanceUID;
    query.sopInstanceUID = sopInstanceUID;

    if (this.cache && this.config.enableCache) {
      const cached = await this.cache.has(
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID
      );
      if (cached) {
        const cachedData = await this.cache.retrieve(
          studyInstanceUID,
          seriesInstanceUID,
          sopInstanceUID
        );
        if (cachedData) {
          this.sendDicomResponse(
            res,
            cachedData,
            true,
            query.multipart !== false
          );
          return;
        }
      }
    }

    const result = await this.dimseClient.retrieveInstance(
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
      this.config.useCget,
      signal
    );

    if (result.error) {
      let statusCode = 500;
      if (result.error.includes("49152")) {
        result.error +=
          " (Likely no instance found with this UID, or no matching peers) " +
          "Requested Instance UID: " +
          sopInstanceUID;
        statusCode = 404;
      }
      sendError(res, statusCode, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      sendError(res, 404, "Instance not found");
      return;
    }

    const dataset = result.datasets[0];
    if (!dataset) {
      sendError(res, 404, "Instance data not found");
      return;
    }

    const instanceBuffer = await this.datasetToBuffer(dataset);

    if (this.cache && this.config.enableCache) {
      await this.cache.store(
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID,
        instanceBuffer
      );
    }

    this.sendDicomResponse(
      res,
      instanceBuffer,
      false,
      query.multipart !== false
    );
  }

  private async datasetToBuffer(dataset: DimseDataset): Promise<Buffer> {
    try {
      const { StorageClass } = constants;

      if (dataset instanceof Dataset) {
        // Clean up problematic DICOM elements that have incorrect VRs
        const elements = dataset.getElements();
        const cleanedElements = this.cleanupDicomElements(
          elements as DicomElements
        );

        // Create proper DICOM P10 structure with meta header (following toFile() logic)
        const elementsWithMeta = {
          _meta: {
            FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
            MediaStorageSOPClassUID:
              cleanedElements["SOPClassUID"] ||
              StorageClass.SecondaryCaptureImageStorage,
            MediaStorageSOPInstanceUID:
              cleanedElements["SOPInstanceUID"] || Dataset.generateDerivedUid(),
            TransferSyntaxUID: dataset.getTransferSyntaxUid(),
            ImplementationClassUID: Implementation.getImplementationClassUid(),
            ImplementationVersionName:
              Implementation.getImplementationVersion(),
          },
          ...cleanedElements,
        };

        // Create DicomDict and write as proper P10 file
        const denaturalizedMetaHeader =
          dcmjs.data.DicomMetaDictionary.denaturalizeDataset(
            elementsWithMeta._meta
          );
        const dicomDict = new dcmjs.data.DicomDict(denaturalizedMetaHeader);

        dicomDict.dict =
          dcmjs.data.DicomMetaDictionary.denaturalizeDataset(elementsWithMeta);

        const writeOptions = {
          allowInvalidVRLength: true,
        };

        const buffer = Buffer.from(dicomDict.write(writeOptions));
        return buffer;
      }

      return Buffer.from(JSON.stringify(dataset));
    } catch (error) {
      logger.error("Error converting dataset to buffer", error instanceof Error ? error : new Error(String(error)), {
        datasetType: typeof dataset,
        outputFormat: 'buffer'
      });
      return Buffer.from("");
    }
  }

  // @ts-ignore
  private cleanupDicomElements(elements: DicomElements): DicomElements {
    const cleaned = { ...elements };
    let removedCount = 0;

    for (const [tag, naturalizedValue] of Object.entries(cleaned)) {
      if (!naturalizedValue) continue;
      if (tag === "_vrMap") continue;

      // Skip private tags (odd group numbers) - they can have any VR
      const groupNumber = parseInt(tag.substring(0, 4), 16);
      if (groupNumber % 2 === 1) continue;

      // Get the expected VR from DICOM standard
      const standardTag = dcmjs.data.DicomMetaDictionary.nameMap[tag];
      if (!standardTag) continue; // Unknown tag, leave it alone

      const expectedVR: string = standardTag.vr;

      // Check if this element has problems
      const isProblematic =
        // Empty object (result of failed denaturalization)
        (typeof naturalizedValue === "object" &&
          !Array.isArray(naturalizedValue) &&
          Object.keys(naturalizedValue).length === 0) ||
        // Sequence without array
        (expectedVR === "SQ" && !Array.isArray(naturalizedValue)) ||
        // Binary data where sequence is expected
        (expectedVR === "SQ" &&
          (naturalizedValue as any[])[0] instanceof ArrayBuffer) ||
        // Buffer-like object where sequence is expected
        (expectedVR === "SQ" &&
          (naturalizedValue as any[])[0]?.buffer instanceof ArrayBuffer) ||
        // Empty object where sequence is expected but got malformed data
        (expectedVR === "SQ" &&
          (naturalizedValue as any[])[0] &&
          Object.keys((naturalizedValue as any[])[0]).length === 0);

      if (isProblematic) {
        delete cleaned[tag];
        removedCount++;
      }
    }

    // Also remove any element that's an empty object (likely failed denaturalization)
    for (const [tag, element] of Object.entries(cleaned)) {
      if (
        element &&
        typeof element === "object" &&
        !Array.isArray(element) &&
        !element.Value &&
        !element.InlineBinary &&
        Object.keys(element).length === 0
      ) {
        delete cleaned[tag];
        removedCount++;
      }
    }

    return cleaned;
  }

  private sendDicomResponse(
    res: ServerResponse,
    data: Buffer,
    fromCache: boolean,
    useMultipart: boolean = true
  ): void {
    if (useMultipart) {
      // Use multipart MIME encoding for WADO-RS compliance
      const boundary = DicomWebTranslator.createMultipartBoundary();
      const multipartData = DicomWebTranslator.createMultipartResponse(
        [data],
        boundary
      );

      const headers: Record<string, string> = {
        "Content-Type": `multipart/related; type="application/dicom"; boundary=${boundary}`,
        "Content-Length": multipartData.length.toString(),
        "Cache-Control": fromCache ? "max-age=3600" : "no-cache",
      };

      if (fromCache) {
        headers["X-Cache"] = "HIT";
      } else {
        headers["X-Cache"] = "MISS";
      }

      res.writeHead(200, headers);
      res.end(multipartData);
    } else {
      // Send raw DICOM data without multipart wrapping
      const headers: Record<string, string> = {
        "Content-Type": "application/dicom",
        "Content-Length": data.length.toString(),
        "Cache-Control": fromCache ? "max-age=3600" : "no-cache",
      };

      if (fromCache) {
        headers["X-Cache"] = "HIT";
      } else {
        headers["X-Cache"] = "MISS";
      }

      res.writeHead(200, headers);
      res.end(data);
    }
  }

  /**
   * Streams a multipart/related WADO-RS response instance-by-instance using
   * chunked transfer encoding. Each instance is serialized, written, cached,
   * and released before the next one — so peak memory is ~one instance rather
   * than the whole study buffered and then concatenated into a second copy.
   * A single-instance result is sent as one buffered part (small, known size).
   */
  private async streamDatasets(
    res: ServerResponse,
    datasets: DimseDataset[],
    query: WadoQuery,
    cacheKeyFor: (dataset: DimseDataset) => {
      study: string;
      series: string;
      sop: string;
    }
  ): Promise<void> {
    // Single instance: keep the simple buffered path with a known Content-Length.
    if (datasets.length === 1) {
      const dataset = datasets[0]!;
      const buffer = await this.datasetToBuffer(dataset);
      await this.maybeCache(dataset, buffer, cacheKeyFor);
      this.sendDicomResponse(res, buffer, false, query.multipart !== false);
      return;
    }

    const boundary = DicomWebTranslator.createMultipartBoundary();
    // No Content-Length: we free each buffer as we go, so Node uses chunked
    // transfer encoding (standard HTTP/1.1, handled transparently by clients).
    res.writeHead(200, {
      "Content-Type": `multipart/related; type="application/dicom"; boundary=${boundary}`,
      "Cache-Control": "no-cache",
      "X-Cache": "MISS",
    });

    for (let i = 0; i < datasets.length; i++) {
      if (res.writableEnded || res.destroyed) {
        logger.warn("WADO client disconnected mid-response; stopping stream");
        return;
      }
      const dataset = datasets[i]!;
      const buffer = await this.datasetToBuffer(dataset);

      const partHeader = Buffer.from(
        `--${boundary}\r\nContent-Type: application/dicom\r\nContent-Length: ${buffer.length}\r\n\r\n`
      );
      await this.writeChunk(res, partHeader);
      await this.writeChunk(res, buffer);
      await this.writeChunk(res, Buffer.from("\r\n"));

      await this.maybeCache(dataset, buffer, cacheKeyFor);

      // Release references so the buffer and source dataset can be GC'd before
      // the next instance is serialized.
      datasets[i] = undefined as unknown as DimseDataset;
    }

    if (!res.writableEnded && !res.destroyed) {
      await this.writeChunk(res, Buffer.from(`--${boundary}--\r\n`));
      res.end();
    }
  }

  private async maybeCache(
    dataset: DimseDataset,
    buffer: Buffer,
    cacheKeyFor: (dataset: DimseDataset) => {
      study: string;
      series: string;
      sop: string;
    }
  ): Promise<void> {
    if (this.cache && this.config.enableCache) {
      const key = cacheKeyFor(dataset);
      await this.cache.store(key.study, key.series, key.sop, buffer);
    }
  }

  /**
   * Writes a chunk and respects backpressure: if the socket buffer is full it
   * waits for 'drain' before resolving, so a slow client can't make us buffer
   * an unbounded amount in memory. Rejects if the write fails (e.g. the client
   * disconnected), which surfaces as the stream stopping.
   */
  private writeChunk(res: ServerResponse, chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      // Stream already closed (e.g. client disconnected): treat as a graceful
      // stop — the streaming loop's top-of-iteration guard will end the loop.
      if (res.writableEnded || res.destroyed) {
        resolve();
        return;
      }
      const flushed = res.write(chunk, (err?: Error | null) => {
        if (err) reject(err);
      });
      if (flushed) {
        resolve();
      } else {
        res.once("drain", resolve);
      }
    });
  }
}
