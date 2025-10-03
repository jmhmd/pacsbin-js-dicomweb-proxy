import { Buffer } from "node:buffer";
import DcmjsDimse from "dcmjs-dimse";
import { ProxyConfig } from "../types";
import { CMoveRequestTracker } from "./request-tracker";
import { DimseTlsManager } from "./tls-manager";
import { logger } from "../utils/logger";

const { Server, Scp, responses, constants } = DcmjsDimse;
const { CStoreResponse, CEchoResponse } = responses;
const {
  Status,
  PresentationContextResult,
  SopClass,
  StorageClass,
  TransferSyntax,
  RejectResult,
  RejectSource,
  RejectReason
} = constants;

/**
 * TLS PDU types for detection
 */
const TLS_PDU_TYPES = {
  CHANGE_CIPHER_SPEC: 20,
  ALERT: 21,
  HANDSHAKE: 22,
  APPLICATION_DATA: 23
} as const;

/**
 * Detect if incoming data looks like a TLS handshake
 */
function isTlsHandshake(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;

  // TLS record format: [Type][Version Major][Version Minor][Length High][Length Low]
  const recordType = buffer[0];
  const versionMajor = buffer[1];
  const versionMinor = buffer[2];

  // Check for TLS record types (20-23) and valid TLS versions
  const validRecordType = recordType !== undefined && recordType >= 20 && recordType <= 23;
  const validVersion = versionMajor === 3 && versionMinor !== undefined && versionMinor >= 1 && versionMinor <= 4; // TLS 1.0-1.3

  return validRecordType && validVersion;
}

/**
 * Generate helpful error message for TLS mismatch
 */
function getTlsMismatchError(buffer: Buffer, serverHasTls: boolean): string {
  const recordType = buffer.length > 0 ? buffer[0] : 0;
  const recordTypeName = Object.entries(TLS_PDU_TYPES).find(([_, value]) => value === recordType)?.[0] || 'UNKNOWN';

  if (serverHasTls) {
    return `Client is attempting TLS connection (PDU type ${recordType}/${recordTypeName}) but server TLS is enabled. ` +
           `This suggests a TLS configuration mismatch. Check client and server TLS settings.`;
  } else {
    return `Client is attempting TLS connection (PDU type ${recordType}/${recordTypeName}) but server TLS is disabled. ` +
           `Enable TLS on server or disable TLS on client. ` +
           `If using dcmtk tools, remove --enable-tls flag. If server should use TLS, add securityOptions to config.`;
  }
}

/**
 * Custom DIMSE SCP implementation that validates C-STORE requests
 * against pending C-MOVE operations
 */
class DicomWebProxyScp extends Scp {
  // Static references to be used by all SCP instances
  static requestTracker: CMoveRequestTracker;
  static config: ProxyConfig["dimseProxySettings"];
  static allowedPeers: string[];
  static tlsManager: DimseTlsManager;

  private tlsDetectionDone = false;

  constructor(socket: any, opts?: any) {
    super(socket, opts);
    logger.info('New SCP instance created', { component: 'DIMSE_SCP' });

    // Add TLS detection and logging for incoming data
    if (socket) {
      socket.on('data', (data: Buffer) => {
        logger.debug('Received data on socket', { component: 'DIMSE_SCP' });

        // Only check for TLS mismatch on the first data packet
        if (!this.tlsDetectionDone && data && data.length > 0) {
          this.tlsDetectionDone = true;

          if (isTlsHandshake(data)) {
            const serverHasTls = DicomWebProxyScp.tlsManager?.isEnabled() ?? false;
            const errorMessage = getTlsMismatchError(data, serverHasTls);

            logger.error('TLS MISMATCH DETECTED', undefined, { component: 'DIMSE_SCP', errorMessage });
            logger.error('Connection details for TLS mismatch', undefined, {
              component: 'DIMSE_SCP',
              clientData: `First 10 bytes: ${Array.from(data.slice(0, 10)).map((b: number) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')}`,
              serverTlsEnabled: serverHasTls,
              detectedProtocol: 'TLS/SSL',
              expectedProtocol: 'DICOM'
            });

            // Close the connection gracefully
            logger.warn('Closing connection due to TLS mismatch', { component: 'DIMSE_SCP' });
            if (socket && typeof socket.end === 'function') {
              socket.end();
            }
            return;
          }
        }
      });

      socket.on('error', (error: Error) => {
        logger.error('Socket error', error, { component: 'DIMSE_SCP' });

        // Check if this looks like a TLS-related error
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('unknown pdu') ||
            errorMessage.includes('pdu type') ||
            errorMessage.includes('connection error')) {

          const serverHasTls = DicomWebProxyScp.tlsManager?.isEnabled() ?? false;
          logger.error('🔒 POTENTIAL TLS MISMATCH: The error above may be caused by TLS configuration mismatch', undefined, { component: 'DIMSE_SCP' });
          logger.error('Server TLS status', undefined, { component: 'DIMSE_SCP', serverTlsStatus: serverHasTls ? 'ENABLED' : 'DISABLED' });
          logger.error('TLS mismatch recommendation', undefined, {
            component: 'DIMSE_SCP',
            recommendation: serverHasTls
              ? 'Ensure client is using TLS, or disable TLS on server'
              : 'Ensure client is not using TLS, or enable TLS on server'
          });
        }
      });

      socket.on('close', () => {
        logger.debug('Socket closed', { component: 'DIMSE_SCP' });
      });
    }
  }

  /**
   * Handle association release requests
   */
  public override associationReleaseRequested(): void {
    logger.info('Association release requested - sending release response', { component: 'DIMSE_SCP' });
    this.sendAssociationReleaseResponse();
  }

  /**
   * Handle association requests - validate calling AET
   */
  public override associationRequested(association: any): void {
    const callingAET = association.getCallingAeTitle();
    const calledAET = association.getCalledAeTitle();
    
    logger.info('Association request received', { component: 'DIMSE_SCP', callingAET, calledAET });

    // Store the association for later use
    (this as any).association = association;

    // Validate calling AET is in allowed peers
    if (!DicomWebProxyScp.allowedPeers.includes(callingAET)) {
      logger.warn('Rejecting association from unauthorized AET', { component: 'DIMSE_SCP', callingAET });
      this.sendAssociationReject(
        RejectResult.Permanent,
        RejectSource.ServiceUser,
        RejectReason.CallingAeNotRecognized
      );
      return;
    }

    // Validate called AET matches our configured AET
    if (DicomWebProxyScp.config && calledAET !== DicomWebProxyScp.config.proxyServer.aet) {
      logger.warn('Called AET does not match configured AET', { component: 'DIMSE_SCP', calledAET, configuredAET: DicomWebProxyScp.config.proxyServer.aet });
      this.sendAssociationReject(
        RejectResult.Permanent,
        RejectSource.ServiceUser,
        RejectReason.CalledAeNotRecognized
      );
      return;
    }

    logger.info('Association accepted - negotiating presentation contexts', { component: 'DIMSE_SCP', callingAET });
    
    // Negotiate presentation contexts properly
    const contexts = association.getPresentationContexts();
    logger.debug('Received presentation contexts', { component: 'DIMSE_SCP', contextCount: contexts.length });
    
    let acceptedCount = 0;
    let rejectedCount = 0;
    
    contexts.forEach((c: any) => {
      const context = association.getPresentationContext(c.id);
      const abstractSyntax = context.getAbstractSyntaxUid();
      const transferSyntaxes = context.getTransferSyntaxUids();
      
      // Accept Verification (C-ECHO), Query/Retrieve classes, and ALL Storage classes
      if (
        abstractSyntax === SopClass.Verification ||
        abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelFind ||
        abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelMove ||
        abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelGet ||
        Object.values(StorageClass).includes(abstractSyntax)
      ) {
        // Find a supported transfer syntax (prefer uncompressed, but accept common compressed formats)
        let acceptedTransferSyntax = null;
        
        // Priority order: uncompressed first, then common compressed formats
        const preferredTransferSyntaxes = [
          TransferSyntax.ExplicitVRLittleEndian,
          TransferSyntax.ImplicitVRLittleEndian,
          TransferSyntax.ExplicitVRBigEndian,
          // Common compressed transfer syntaxes
          TransferSyntax.JpegBaseline,
          TransferSyntax.JpegLossless,
          TransferSyntax.JpegLsLossless,
          TransferSyntax.JpegLsLossy,
          TransferSyntax.Jpeg2000Lossless,
          TransferSyntax.Jpeg2000Lossy,
          TransferSyntax.RleLossless
        ];
        
        for (const preferredSyntax of preferredTransferSyntaxes) {
          if (transferSyntaxes.includes(preferredSyntax)) {
            acceptedTransferSyntax = preferredSyntax;
            break;
          }
        }
        
        // If no preferred syntax found, accept the first available
        if (!acceptedTransferSyntax && transferSyntaxes.length > 0) {
          acceptedTransferSyntax = transferSyntaxes[0];
          logger.debug('Using fallback transfer syntax', { component: 'DIMSE_SCP', transferSyntax: acceptedTransferSyntax });
        }
        
        if (acceptedTransferSyntax) {
          context.setResult(PresentationContextResult.Accept, acceptedTransferSyntax);
          acceptedCount++;
          // Only log specific contexts for verification and query/retrieve
          if (abstractSyntax === SopClass.Verification || 
              abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelFind ||
              abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelMove ||
              abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelGet) {
            logger.debug('Accepted presentation context', { component: 'DIMSE_SCP', contextId: c.id, abstractSyntax, transferSyntax: acceptedTransferSyntax });
          }
        } else {
          context.setResult(PresentationContextResult.RejectTransferSyntaxesNotSupported);
          rejectedCount++;
        }
      } else {
        context.setResult(PresentationContextResult.RejectAbstractSyntaxNotSupported);
        rejectedCount++;
      }
    });
    
    logger.info('Context negotiation complete', { component: 'DIMSE_SCP', acceptedCount, rejectedCount });
    this.sendAssociationAccept();
    logger.info('Association accept sent', { component: 'DIMSE_SCP' });
  }

  /**
   * Handle C-ECHO requests
   */
  public override cEchoRequest(request: any, callback: Function): void {
    logger.debug('C-ECHO request received - responding with Success', { component: 'DIMSE_SCP' });
    try {
      const response = CEchoResponse.fromRequest(request);
      response.setStatus(Status.Success);
      logger.debug('Calling callback with C-ECHO response', { component: 'DIMSE_SCP' });
      callback(response);
      logger.debug('C-ECHO response sent successfully', { component: 'DIMSE_SCP' });
    } catch (error) {
      logger.error('Error handling C-ECHO request', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP' });
      callback(null);
    }
  }

  /**
   * Handle C-STORE requests with validation against pending C-MOVE operations
   */
  public override cStoreRequest(request: any, callback: Function): void {
    try {
      const dataset = request.getDataset();
      let studyInstanceUID: string | undefined;
      let seriesInstanceUID: string | undefined;
      let sopInstanceUID: string | undefined;

      if (dataset && dataset.getElements) {
        const elements = dataset.getElements();
        studyInstanceUID = elements["StudyInstanceUID"] as string;
        seriesInstanceUID = elements["SeriesInstanceUID"] as string;
        sopInstanceUID = elements["SOPInstanceUID"] as string;
      }

      logger.debug('C-STORE request received', { component: 'DIMSE_SCP', studyInstanceUID, seriesInstanceUID, sopInstanceUID });

      // Validate the C-STORE request against pending C-MOVE operations
      const validationResult = DicomWebProxyScp.requestTracker.validateCStoreRequest(
        studyInstanceUID!,
        seriesInstanceUID,
        sopInstanceUID
      );

      const response = CStoreResponse.fromRequest(request);

      if (!validationResult.isValid) {
        logger.warn('Rejecting unsolicited C-STORE', { component: 'DIMSE_SCP', reason: validationResult.reason });
        response.setStatus(Status.NotAuthorized);
        callback(response);
        return;
      }

      // Process the validated C-STORE dataset
      const processed = DicomWebProxyScp.requestTracker.processCStoreDataset(
        validationResult.correlationId!,
        dataset
      );

      if (processed) {
        logger.info('C-STORE accepted and processed', { component: 'DIMSE_SCP', correlationId: validationResult.correlationId });
        response.setStatus(Status.Success);
      } else {
        logger.error('Failed to process C-STORE dataset', undefined, { component: 'DIMSE_SCP', correlationId: validationResult.correlationId });
        response.setStatus(Status.ProcessingFailure);
      }

      callback(response);

    } catch (error) {
      logger.error('Error processing C-STORE request', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP' });
      const response = CStoreResponse.fromRequest(request);
      response.setStatus(Status.ProcessingFailure);
      callback(response);
    }
  }

  /**
   * Handle other DIMSE requests (reject them)
   */
  public override cFindRequest(_request: any, callback: Function): void {
    logger.warn('C-FIND request rejected - not supported', { component: 'DIMSE_SCP' });
    // Note: dcmjs-dimse doesn't export CFindResponse, so we'll use a generic approach
    callback(null); // This should trigger a not-supported response
  }

  public override cMoveRequest(_request: any, callback: Function): void {
    logger.warn('C-MOVE request rejected - not supported', { component: 'DIMSE_SCP' });
    callback(null); // This should trigger a not-supported response
  }

  public override cGetRequest(_request: any, callback: Function): void {
    logger.warn('C-GET request rejected - not supported', { component: 'DIMSE_SCP' });
    callback(null); // This should trigger a not-supported response
  }
}

/**
 * DIMSE SCP Server that manages the lifecycle of the SCP listener
 */
export class DimseScpServer {
  private server: any = null;
  private requestTracker: CMoveRequestTracker;
  private allowedPeers: string[];
  private tlsManager: DimseTlsManager;

  constructor(private config: ProxyConfig["dimseProxySettings"]) {
    if (!config) {
      throw new Error("DIMSE proxy settings are required for SCP server");
    }

    this.requestTracker = new CMoveRequestTracker();
    this.allowedPeers = config.peers.map(peer => peer.aet);
    this.tlsManager = new DimseTlsManager(config.proxyServer.securityOptions);

    // Log TLS configuration status with helpful information
    const tlsEnabled = this.tlsManager.isEnabled();
    logger.info('DIMSE SCP Server configured', { component: 'DIMSE_SCP_SERVER', aet: config.proxyServer.aet, port: config.proxyServer.port, tlsEnabled });
    logger.info('Allowed peers configured', { component: 'DIMSE_SCP_SERVER', allowedPeers: this.allowedPeers });

    if (tlsEnabled) {
      logger.info('DIMSE TLS Configuration:', { component: 'DIMSE_SCP_SERVER' });
      const secOpts = config.proxyServer.securityOptions;
      if (secOpts) {
        logger.info('TLS Certificate configured', { component: 'DIMSE_SCP_SERVER', cert: secOpts.cert });
        logger.info('TLS Private Key configured', { component: 'DIMSE_SCP_SERVER', key: secOpts.key });
        if (secOpts.ca) logger.info('TLS CA Certificate configured', { component: 'DIMSE_SCP_SERVER', ca: secOpts.ca });
        logger.info('TLS Request Client Certs setting', { component: 'DIMSE_SCP_SERVER', requestCert: secOpts.requestCert ?? false });
        logger.info('TLS Reject Unauthorized setting', { component: 'DIMSE_SCP_SERVER', rejectUnauthorized: secOpts.rejectUnauthorized ?? true });
        logger.info('TLS Version configuration', { component: 'DIMSE_SCP_SERVER', minVersion: secOpts.minVersion ?? 'TLS 1.0', maxVersion: secOpts.maxVersion ?? 'Latest' });
        logger.info('Client connections MUST use TLS (e.g., echoscu --enable-tls ...)', { component: 'DIMSE_SCP_SERVER' });
      }
    } else {
      logger.info('DIMSE TLS is DISABLED', { component: 'DIMSE_SCP_SERVER' });
      logger.info('Client connections must NOT use TLS (e.g., echoscu without --enable-tls)', { component: 'DIMSE_SCP_SERVER' });
    }
  }

  /**
   * Start the DIMSE SCP server
   */
  public async start(): Promise<void> {
    if (this.server) {
      throw new Error("DIMSE SCP server is already running");
    }

    return new Promise((resolve, reject) => {
      try {
        // Set static references for SCP instances
        DicomWebProxyScp.requestTracker = this.requestTracker;
        DicomWebProxyScp.config = this.config;
        DicomWebProxyScp.allowedPeers = this.allowedPeers;
        DicomWebProxyScp.tlsManager = this.tlsManager;

        this.server = new Server(DicomWebProxyScp);

        this.server.on('networkError', (error: Error) => {
          logger.error('DIMSE SCP Server network error', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP_SERVER' });
        });

        this.server.on('associationReleased', () => {
          logger.info('Association released', { component: 'DIMSE_SCP_SERVER' });
        });

        // Handle server errors
        this.server.on('error', (error: Error) => {
          logger.error('DIMSE SCP Server error', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP_SERVER' });
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        });

        let resolved = false;

        // Prepare server options with TLS if enabled
        const serverOptions: any = {};

        if (this.tlsManager.isEnabled()) {
          try {
            const tlsOptions = this.tlsManager.getTlsOptions();
            if (tlsOptions) {
              serverOptions.securityOptions = tlsOptions;
              logger.info('TLS options configured successfully', { component: 'DIMSE_SCP_SERVER' });
            }
          } catch (error) {
            logger.error('Failed to configure DIMSE TLS options', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP_SERVER' });
            resolved = true;
            reject(error);
            return;
          }
        }

        // Start listening with TLS options if configured
        this.server.listen(this.config!.proxyServer.port, serverOptions);

        // Resolve immediately since dcmjs-dimse server doesn't have a callback
        resolved = true;
        resolve();

      } catch (error) {
        logger.error('Failed to start DIMSE SCP server', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP_SERVER' });
        reject(error);
      }
    });
  }

  /**
   * Stop the DIMSE SCP server
   */
  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    logger.info('Stopping server...', { component: 'DIMSE_SCP_SERVER' });

    // Shutdown the request tracker first
    this.requestTracker.shutdown();

    return new Promise((resolve) => {
      // Set a timeout to avoid hanging forever
      const timeout = setTimeout(() => {
        logger.warn('Shutdown timeout reached, forcing stop', { component: 'DIMSE_SCP_SERVER' });
        this.server = null;
        resolve();
      }, 5000); // 5 second timeout

      try {
        // Try to close the server gracefully
        if (this.server && typeof this.server.close === 'function') {
          this.server.close();
          logger.info('Server stopped gracefully', { component: 'DIMSE_SCP_SERVER' });
          clearTimeout(timeout);
          this.server = null;
          resolve();
        } else {
          // If no close method or callback, just resolve immediately
          logger.info('No close callback available, stopping immediately', { component: 'DIMSE_SCP_SERVER' });
          clearTimeout(timeout);
          this.server = null;
          resolve();
        }
      } catch (error) {
        logger.error('Error during shutdown', error instanceof Error ? error : new Error(String(error)), { component: 'DIMSE_SCP_SERVER' });
        clearTimeout(timeout);
        this.server = null;
        resolve();
      }
    });
  }

  /**
   * Get the request tracker for integration with DimseClient
   */
  public getRequestTracker(): CMoveRequestTracker {
    return this.requestTracker;
  }

  /**
   * Check if the server is running
   */
  public isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get server statistics
   */
  public getStats() {
    return {
      isRunning: this.isRunning(),
      port: this.config?.proxyServer.port,
      aet: this.config?.proxyServer.aet,
      allowedPeers: this.allowedPeers,
      tlsEnabled: this.tlsManager.isEnabled(),
      requestTracker: this.requestTracker.getStats(),
    };
  }
}