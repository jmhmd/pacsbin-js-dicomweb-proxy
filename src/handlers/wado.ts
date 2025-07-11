import { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
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

export class WadoHandler {
  private config: ProxyConfig;
  private dimseClient: DimseClient;
  private cache: FileCache | null;

  constructor(config: ProxyConfig, cache: FileCache | null) {
    this.config = config;
    this.cache = cache;

    if (config.proxyMode === "dimse" && config.dimseProxySettings) {
      this.dimseClient = new DimseClient(config.dimseProxySettings);
    } else {
      throw new Error("WADO handler requires DIMSE proxy mode");
    }
  }

  public getHandler(): RequestHandler {
    return async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(
          req.url || "",
          `http://${req.headers.host || "localhost"}`
        );
        const pathParts = url.pathname.split("/").filter((part) => part);

        if (pathParts.length < 2 || pathParts[0] !== "studies") {
          this.sendError(res, 404, "Not Found");
          return;
        }

        const query = this.parseQuery(url.searchParams);

        if (pathParts.length === 2) {
          await this.handleStudyRetrieval(req, res, pathParts[1]!, query);
        } else if (pathParts.length === 4 && pathParts[2] === "series") {
          await this.handleSeriesRetrieval(
            req,
            res,
            pathParts[1]!,
            pathParts[3]!,
            query
          );
        } else if (
          pathParts.length === 6 &&
          pathParts[2] === "series" &&
          pathParts[4] === "instances"
        ) {
          await this.handleInstanceRetrieval(
            req,
            res,
            pathParts[1]!,
            pathParts[3]!,
            pathParts[5]!,
            query
          );
        } else {
          this.sendError(res, 404, "Not Found");
        }
      } catch (error) {
        console.error("WADO handler error:", error);
        this.sendError(res, 500, "Internal Server Error");
      }
    };
  }

  private parseQuery(searchParams: URLSearchParams): WadoQuery {
    const query: WadoQuery = {
      studyInstanceUID: "",
      requestType: "WADO-RS",
    };

    for (const [key, value] of searchParams) {
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
        case "charset":
          query.charset = value;
          break;
        case "anonymize":
          query.anonymize = value;
          break;
        case "annotation":
          query.annotation = value;
          break;
        case "rows":
          query.rows = parseInt(value, 10);
          break;
        case "columns":
          query.columns = parseInt(value, 10);
          break;
        case "region":
          query.region = value;
          break;
        case "windowCenter":
          query.windowCenter = parseInt(value, 10);
          break;
        case "windowWidth":
          query.windowWidth = parseInt(value, 10);
          break;
        case "frameNumber":
          query.frameNumber = parseInt(value, 10);
          break;
        case "imageQuality":
          query.imageQuality = parseInt(value, 10);
          break;
        case "presentationUID":
          query.presentationUID = value;
          break;
        case "presentationSeriesUID":
          query.presentationSeriesUID = value;
          break;
        case "transferSyntax":
          query.transferSyntax = value;
          break;
      }
    }

    return query;
  }

  private async handleStudyRetrieval(
    _req: IncomingMessage,
    res: ServerResponse,
    studyInstanceUID: string,
    query: WadoQuery
  ): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, "Invalid StudyInstanceUID");
      return;
    }

    query.studyInstanceUID = studyInstanceUID;

    if (this.cache && this.config.enableCache) {
      const cached = await this.cache.has(studyInstanceUID);
      if (cached) {
        const cachedData = await this.cache.retrieve(studyInstanceUID);
        if (cachedData) {
          this.sendDicomResponse(res, cachedData, true);
          return;
        }
      }
    }

    const result = await this.dimseClient.retrieveStudy(
      studyInstanceUID,
      this.config.useCget
    );

    if (result.error) {
      this.sendError(res, 500, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      this.sendError(res, 404, "Study not found");
      return;
    }

    const instances: Buffer[] = [];
    for (const dataset of result.datasets) {
      const instanceBuffer = await this.datasetToBuffer(dataset);
      instances.push(instanceBuffer);

      // Store in cache if enabled
      if (this.cache && this.config.enableCache) {
        const elements = dataset.getElements();
        await this.cache.store(
          studyInstanceUID,
          (elements["SeriesInstanceUID"] as string) || "",
          (elements["SOPInstanceUID"] as string) || "",
          instanceBuffer
        );
      }
    }

    if (instances.length === 1) {
      const instance = instances[0];
      if (instance) {
        this.sendDicomResponse(res, instance, false);
      } else {
        this.sendError(res, 500, "Failed to retrieve instance data");
      }
    } else {
      this.sendMultipartResponse(res, instances);
    }
  }

  private async handleSeriesRetrieval(
    _req: IncomingMessage,
    res: ServerResponse,
    studyInstanceUID: string,
    seriesInstanceUID: string,
    query: WadoQuery
  ): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, "Invalid StudyInstanceUID");
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      this.sendError(res, 400, "Invalid SeriesInstanceUID");
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
          this.sendDicomResponse(res, cachedData, true);
          return;
        }
      }
    }

    const result = await this.dimseClient.retrieveSeries(
      studyInstanceUID,
      seriesInstanceUID,
      this.config.useCget
    );

    if (result.error) {
      this.sendError(res, 500, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      this.sendError(res, 404, "Series not found");
      return;
    }

    const instances: Buffer[] = [];
    for (const dataset of result.datasets) {
      const instanceBuffer = await this.datasetToBuffer(dataset);
      instances.push(instanceBuffer);

      // Store in cache if enabled
      if (this.cache && this.config.enableCache) {
        const elements = dataset.getElements();
        await this.cache.store(
          studyInstanceUID,
          seriesInstanceUID,
          (elements["SOPInstanceUID"] as string) || "",
          instanceBuffer
        );
      }
    }

    if (instances.length === 1) {
      const instance = instances[0];
      if (instance) {
        this.sendDicomResponse(res, instance, false);
      } else {
        this.sendError(res, 500, "Failed to retrieve instance data");
      }
    } else {
      this.sendMultipartResponse(res, instances);
    }
  }

  private async handleInstanceRetrieval(
    _req: IncomingMessage,
    res: ServerResponse,
    studyInstanceUID: string,
    seriesInstanceUID: string,
    sopInstanceUID: string,
    query: WadoQuery
  ): Promise<void> {
    if (!DicomWebTranslator.validateStudyInstanceUID(studyInstanceUID)) {
      this.sendError(res, 400, "Invalid StudyInstanceUID");
      return;
    }

    if (!DicomWebTranslator.validateSeriesInstanceUID(seriesInstanceUID)) {
      this.sendError(res, 400, "Invalid SeriesInstanceUID");
      return;
    }

    if (!DicomWebTranslator.validateSOPInstanceUID(sopInstanceUID)) {
      this.sendError(res, 400, "Invalid SOPInstanceUID");
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
          this.sendDicomResponse(res, cachedData, true);
          return;
        }
      }
    }

    console.log("Calling retrieveInstance with C-GET:", this.config.useCget);
    const result = await this.dimseClient.retrieveInstance(
      studyInstanceUID,
      seriesInstanceUID,
      sopInstanceUID,
      this.config.useCget
    );

    console.log("Retrieve result:", {
      error: result.error,
      completed: result.completed,
      datasetsLength: result.datasets.length,
      failed: result.failed,
      warnings: result.warnings,
    });

    if (result.error) {
      this.sendError(res, 500, `DIMSE retrieval failed: ${result.error}`);
      return;
    }

    if (result.datasets.length === 0) {
      console.log("No datasets returned from DIMSE retrieval");
      this.sendError(res, 404, "Instance not found");
      return;
    }

    console.log("Processing dataset...");
    const dataset = result.datasets[0];
    if (!dataset) {
      this.sendError(res, 404, "Instance data not found");
      return;
    }

    console.log("Converting dataset to buffer...");
    const instanceBuffer = await this.datasetToBuffer(dataset);

    if (this.cache && this.config.enableCache) {
      console.log("Storing in cache...");
      await this.cache.store(
        studyInstanceUID,
        seriesInstanceUID,
        sopInstanceUID,
        instanceBuffer
      );
    }

    console.log("Sending response...");
    this.sendDicomResponse(res, instanceBuffer, false);
  }

  private async datasetToBuffer(dataset: DimseDataset): Promise<Buffer> {
    try {
      console.log("Dataset type:", typeof dataset);
      console.log("Dataset constructor:", dataset?.constructor?.name);
      console.log("Dataset keys:", Object.keys(dataset || {}));

      const { Dataset } = require("dcmjs-dimse");
      if (dataset instanceof Dataset) {
        console.log("Using dcmjs-dimse getDenaturalizedDataset...");

        // Clean up problematic DICOM elements that have incorrect VRs
        const elements = dataset.getElements();
        const cleanedElements = this.cleanupDicomElements(
          elements as DicomElements
        );

        // Create a new dataset with cleaned elements
        const cleanedDataset: DimseDataset = new Dataset(
          cleanedElements,
          dataset.getTransferSyntaxUid()
        );

        // Try with write options that handle non-standard DICOM data
        const writeOptions = {
          allowInvalidVRLength: true,
        };

        const denaturalizedDataset =
          cleanedDataset.getDenaturalizedDataset(writeOptions);
        return denaturalizedDataset;
      }

      console.log("Dataset is not a Dataset instance, converting to JSON");
      return Buffer.from(JSON.stringify(dataset));
    } catch (error) {
      console.error("Error converting dataset to buffer:", error);
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
          (naturalizedValue as any[])[0].buffer instanceof ArrayBuffer) ||
        // Empty object where sequence is expected but got malformed data
        (expectedVR === "SQ" &&
          Object.keys((naturalizedValue as any[])[0]).length === 0);

      if (isProblematic) {
        console.log(
          `Removing problematic tag ${tag} (${standardTag.name}): got ${naturalizedValue}`
        );
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
        console.log(`Removing empty element tag ${tag}`);
        delete cleaned[tag];
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} problematic DICOM elements`);
    }

    return cleaned;
  }

  private sendDicomResponse(
    res: ServerResponse,
    data: Buffer,
    fromCache: boolean
  ): void {
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

  private sendMultipartResponse(
    res: ServerResponse,
    instances: Buffer[]
  ): void {
    const boundary = DicomWebTranslator.createMultipartBoundary();
    const multipartData = DicomWebTranslator.createMultipartResponse(
      instances,
      boundary
    );

    res.writeHead(200, {
      "Content-Type": `multipart/related; type="application/dicom"; boundary=${boundary}`,
      "Content-Length": multipartData.length.toString(),
      "Cache-Control": "no-cache",
      "X-Cache": "MISS",
    });

    res.end(multipartData);
  }

  private sendError(
    res: ServerResponse,
    statusCode: number,
    message: string
  ): void {
    const errorResponse = {
      error: message,
      statusCode,
      timestamp: new Date().toISOString(),
    };

    const jsonResponse = JSON.stringify(errorResponse);

    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(jsonResponse),
    });

    res.end(jsonResponse);
  }
}
