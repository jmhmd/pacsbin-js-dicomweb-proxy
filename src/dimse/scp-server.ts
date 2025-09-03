import DcmjsDimse from "dcmjs-dimse";
import { ProxyConfig } from "../types";
import { CMoveRequestTracker } from "./request-tracker";

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
 * Custom DIMSE SCP implementation that validates C-STORE requests
 * against pending C-MOVE operations
 */
class DicomWebProxyScp extends Scp {
  // Static references to be used by all SCP instances
  static requestTracker: CMoveRequestTracker;
  static config: ProxyConfig["dimseProxySettings"];
  static allowedPeers: string[];

  constructor(socket: any, opts?: any) {
    super(socket, opts);
    console.log('DIMSE SCP: New SCP instance created');
    
    // Add logging for any incoming data
    if (socket) {
      socket.on('data', () => {
        console.log('DIMSE SCP: Received data on socket');
      });
      socket.on('error', (error: Error) => {
        console.error('DIMSE SCP: Socket error:', error);
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

  constructor(private config: ProxyConfig["dimseProxySettings"]) {
    if (!config) {
      throw new Error("DIMSE proxy settings are required for SCP server");
    }
    
    this.requestTracker = new CMoveRequestTracker();
    this.allowedPeers = config.peers.map(peer => peer.aet);
    
    console.log(`DIMSE SCP Server: Configured for AET ${config.proxyServer.aet} on port ${config.proxyServer.port}`);
    console.log(`DIMSE SCP Server: Allowed peers: ${this.allowedPeers.join(', ')}`);
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

        // Start listening - the server starts immediately
        this.server.listen(this.config!.proxyServer.port);
        // console.log(`DIMSE SCP Server listening on port ${this.config!.proxyServer.port}`);
        
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
      requestTracker: this.requestTracker.getStats(),
    };
  }
}