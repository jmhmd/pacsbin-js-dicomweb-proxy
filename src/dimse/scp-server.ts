import { Buffer } from "node:buffer";
import DcmjsDimse from "dcmjs-dimse";
import { ProxyConfig } from "../types";
import { CMoveRequestTracker } from "./request-tracker";
import { DimseTlsManager } from "./tls-manager";

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
    console.log('DIMSE SCP: New SCP instance created');

    // Add TLS detection and logging for incoming data
    if (socket) {
      socket.on('data', (data: Buffer) => {
        console.log('DIMSE SCP: Received data on socket');

        // Only check for TLS mismatch on the first data packet
        if (!this.tlsDetectionDone && data && data.length > 0) {
          this.tlsDetectionDone = true;

          if (isTlsHandshake(data)) {
            const serverHasTls = DicomWebProxyScp.tlsManager?.isEnabled() ?? false;
            const errorMessage = getTlsMismatchError(data, serverHasTls);

            console.error('DIMSE SCP: TLS MISMATCH DETECTED:', errorMessage);
            console.error('DIMSE SCP: Connection details:', {
              clientData: `First 10 bytes: ${Array.from(data.slice(0, 10)).map((b: number) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')}`,
              serverTlsEnabled: serverHasTls,
              detectedProtocol: 'TLS/SSL',
              expectedProtocol: 'DICOM'
            });

            // Close the connection gracefully
            console.log('DIMSE SCP: Closing connection due to TLS mismatch');
            if (socket && typeof socket.end === 'function') {
              socket.end();
            }
            return;
          }
        }
      });

      socket.on('error', (error: Error) => {
        console.error('DIMSE SCP: Socket error:', error);

        // Check if this looks like a TLS-related error
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('unknown pdu') ||
            errorMessage.includes('pdu type') ||
            errorMessage.includes('connection error')) {

          const serverHasTls = DicomWebProxyScp.tlsManager?.isEnabled() ?? false;
          console.error('🔒 POTENTIAL TLS MISMATCH: The error above may be caused by TLS configuration mismatch.');
          console.error(`   Server TLS status: ${serverHasTls ? 'ENABLED' : 'DISABLED'}`);
          console.error(`   Recommendation: ${serverHasTls
            ? 'Ensure client is using TLS, or disable TLS on server'
            : 'Ensure client is not using TLS, or enable TLS on server'}`);
        }
      });

      socket.on('close', () => {
        console.log('DIMSE SCP: Socket closed');
      });
    }
  }

  /**
   * Handle association release requests
   */
  public override associationReleaseRequested(): void {
    console.log('DIMSE SCP: Association release requested - sending release response');
    this.sendAssociationReleaseResponse();
  }

  /**
   * Handle association requests - validate calling AET
   */
  public override associationRequested(association: any): void {
    const callingAET = association.getCallingAeTitle();
    const calledAET = association.getCalledAeTitle();
    
    console.log(`DIMSE SCP: Association request from ${callingAET} to ${calledAET}`);

    // Store the association for later use
    (this as any).association = association;

    // Validate calling AET is in allowed peers
    if (!DicomWebProxyScp.allowedPeers.includes(callingAET)) {
      console.warn(`DIMSE SCP: Rejecting association from unauthorized AET: ${callingAET}`);
      this.sendAssociationReject(
        RejectResult.Permanent,
        RejectSource.ServiceUser,
        RejectReason.CallingAeNotRecognized
      );
      return;
    }

    // Validate called AET matches our configured AET
    if (DicomWebProxyScp.config && calledAET !== DicomWebProxyScp.config.proxyServer.aet) {
      console.warn(`DIMSE SCP: Called AET ${calledAET} does not match configured AET ${DicomWebProxyScp.config.proxyServer.aet}`);
      this.sendAssociationReject(
        RejectResult.Permanent,
        RejectSource.ServiceUser,
        RejectReason.CalledAeNotRecognized
      );
      return;
    }

    console.log(`DIMSE SCP: Association accepted from ${callingAET} - negotiating presentation contexts`);
    
    // Negotiate presentation contexts properly
    const contexts = association.getPresentationContexts();
    console.log(`DIMSE SCP: Received ${contexts.length} presentation contexts`);
    
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
          console.log(`DIMSE SCP: Using fallback transfer syntax: ${acceptedTransferSyntax}`);
        }
        
        if (acceptedTransferSyntax) {
          context.setResult(PresentationContextResult.Accept, acceptedTransferSyntax);
          acceptedCount++;
          // Only log specific contexts for verification and query/retrieve
          if (abstractSyntax === SopClass.Verification || 
              abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelFind ||
              abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelMove ||
              abstractSyntax === SopClass.StudyRootQueryRetrieveInformationModelGet) {
            console.log(`DIMSE SCP: Accepted PC ${c.id} (${abstractSyntax}) with transfer syntax: ${acceptedTransferSyntax}`);
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
    
    console.log(`DIMSE SCP: Context negotiation complete - Accepted: ${acceptedCount}, Rejected: ${rejectedCount}`);
    this.sendAssociationAccept();
    console.log(`DIMSE SCP: Association accept sent`);
  }

  /**
   * Handle C-ECHO requests
   */
  public override cEchoRequest(request: any, callback: Function): void {
    console.log('DIMSE SCP: C-ECHO request received - responding with Success');
    try {
      const response = CEchoResponse.fromRequest(request);
      response.setStatus(Status.Success);
      console.log('DIMSE SCP: Calling callback with C-ECHO response');
      callback(response);
      console.log('DIMSE SCP: C-ECHO response sent successfully');
    } catch (error) {
      console.error('DIMSE SCP: Error handling C-ECHO request:', error);
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

      console.log(`DIMSE SCP: C-STORE request for Study: ${studyInstanceUID}, Series: ${seriesInstanceUID}, Instance: ${sopInstanceUID}`);

      // Validate the C-STORE request against pending C-MOVE operations
      const validationResult = DicomWebProxyScp.requestTracker.validateCStoreRequest(
        studyInstanceUID!,
        seriesInstanceUID,
        sopInstanceUID
      );

      const response = CStoreResponse.fromRequest(request);

      if (!validationResult.isValid) {
        console.warn(`DIMSE SCP: Rejecting unsolicited C-STORE - ${validationResult.reason}`);
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
        console.log(`DIMSE SCP: C-STORE accepted and processed for correlation ${validationResult.correlationId}`);
        response.setStatus(Status.Success);
      } else {
        console.error(`DIMSE SCP: Failed to process C-STORE dataset for correlation ${validationResult.correlationId}`);
        response.setStatus(Status.ProcessingFailure);
      }

      callback(response);

    } catch (error) {
      console.error('DIMSE SCP: Error processing C-STORE request:', error);
      const response = CStoreResponse.fromRequest(request);
      response.setStatus(Status.ProcessingFailure);
      callback(response);
    }
  }

  /**
   * Handle other DIMSE requests (reject them)
   */
  public override cFindRequest(_request: any, callback: Function): void {
    console.warn('DIMSE SCP: C-FIND request rejected - not supported');
    // Note: dcmjs-dimse doesn't export CFindResponse, so we'll use a generic approach
    callback(null); // This should trigger a not-supported response
  }

  public override cMoveRequest(_request: any, callback: Function): void {
    console.warn('DIMSE SCP: C-MOVE request rejected - not supported');
    callback(null); // This should trigger a not-supported response
  }

  public override cGetRequest(_request: any, callback: Function): void {
    console.warn('DIMSE SCP: C-GET request rejected - not supported');
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
    const tlsStatus = tlsEnabled ? " (TLS enabled)" : " (TLS disabled)";
    console.log(`DIMSE SCP Server: Configured for AET ${config.proxyServer.aet} on port ${config.proxyServer.port}${tlsStatus}`);
    console.log(`DIMSE SCP Server: Allowed peers: ${this.allowedPeers.join(', ')}`);

    if (tlsEnabled) {
      console.log('DIMSE TLS Configuration:');
      const secOpts = config.proxyServer.securityOptions;
      if (secOpts) {
        console.log(`   Certificate: ${secOpts.cert}`);
        console.log(`   Private Key: ${secOpts.key}`);
        if (secOpts.ca) console.log(`   CA Certificate: ${secOpts.ca}`);
        console.log(`   Request Client Certs: ${secOpts.requestCert ?? false}`);
        console.log(`   Reject Unauthorized: ${secOpts.rejectUnauthorized ?? true}`);
        console.log(`   TLS Version: ${secOpts.minVersion ?? 'TLS 1.0'}+ to ${secOpts.maxVersion ?? 'Latest'}`);
        console.log('   Client connections MUST use TLS (e.g., echoscu --enable-tls ...)');
      }
    } else {
      console.log('DIMSE TLS is DISABLED');
      console.log('   Client connections must NOT use TLS (e.g., echoscu without --enable-tls)');
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
          console.error('DIMSE SCP Server network error:', error);
        });

        this.server.on('associationReleased', () => {
          console.log('DIMSE SCP Server: Association released');
        });

        // Handle server errors
        this.server.on('error', (error: Error) => {
          console.error('DIMSE SCP Server error:', error);
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
              console.log('DIMSE SCP Server: TLS options configured successfully');
            }
          } catch (error) {
            console.error('Failed to configure DIMSE TLS options:', error);
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
        console.error('Failed to start DIMSE SCP server:', error);
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

    console.log('DIMSE SCP Server: Stopping server...');

    // Shutdown the request tracker first
    this.requestTracker.shutdown();

    return new Promise((resolve) => {
      // Set a timeout to avoid hanging forever
      const timeout = setTimeout(() => {
        console.log('DIMSE SCP Server: Shutdown timeout reached, forcing stop');
        this.server = null;
        resolve();
      }, 5000); // 5 second timeout

      try {
        // Try to close the server gracefully
        if (this.server && typeof this.server.close === 'function') {
          this.server.close();
          console.log('DIMSE SCP Server stopped gracefully');
          clearTimeout(timeout);
          this.server = null;
          resolve();
        } else {
          // If no close method or callback, just resolve immediately
          console.log('DIMSE SCP Server: No close callback available, stopping immediately');
          clearTimeout(timeout);
          this.server = null;
          resolve();
        }
      } catch (error) {
        console.error('DIMSE SCP Server: Error during shutdown:', error);
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