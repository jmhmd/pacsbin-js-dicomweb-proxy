/**
 * Connection Leak Regression Test
 *
 * This test reproduces a TCP connection leak bug discovered in Deno 2.4.1
 * where C-MOVE operations fail after exactly 512 requests with status 42754
 * (which corresponds to the default TCP backlog limit).
 *
 * The test automatically starts the E2E test environment (Orthanc + test data)
 * if it's not already running. Just run it:
 *
 *   node tests/connection-leak-test.ts
 *   deno run --allow-all tests/connection-leak-test.ts
 *   bun tests/connection-leak-test.ts
 *
 * Environment variables:
 * - ITERATION_COUNT: Number of times to retrieve instance (default: 600)
 * - DELAY_MS: Delay between requests in ms (default: 0)
 * - AUTO_SETUP: Auto-start Docker environment (default: true)
 * - ORTHANC_HOST: Orthanc DICOM host (default: 127.0.0.1)
 * - ORTHANC_PORT: Orthanc DICOM port (default: 4242)
 * - ORTHANC_AET: Orthanc AET (default: ORTHANC)
 * - ORTHANC_HTTP_URL: Orthanc HTTP URL (default: http://localhost:8042)
 * - SCP_PORT: Port for test SCP server (default: 9999)
 * - SCP_AET: AET for test SCP server (default: LEAK_TEST_SCP)
 */

import DcmjsDimse from "dcmjs-dimse";
import { setTimeout } from "node:timers/promises";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { Client, Server, Scp, requests, responses, constants } = DcmjsDimse;
const { CMoveRequest } = requests;
const { CStoreResponse, CEchoResponse } = responses;
const { Status, PresentationContextResult, SopClass, StorageClass, TransferSyntax } = constants;

// Get script directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration from environment
const CONFIG = {
  iterationCount: parseInt(process.env.ITERATION_COUNT || "600", 10),
  delayMs: parseInt(process.env.DELAY_MS || "0", 10),
  orthancHost: process.env.ORTHANC_HOST || "127.0.0.1",
  orthancPort: parseInt(process.env.ORTHANC_PORT || "4242", 10),
  orthancAet: process.env.ORTHANC_AET || "ORTHANC",
  orthancHttpUrl: process.env.ORTHANC_HTTP_URL || "http://localhost:8042",
  scpPort: parseInt(process.env.SCP_PORT || "9999", 10),
  scpAet: process.env.SCP_AET || "LEAK_TEST_SCP",
  testDataDir: join(__dirname, "e2e", "test-data"),
  startupTimeout: 60000,
  autoSetup: process.env.AUTO_SETUP !== "false", // Default to true
};

// Detect runtime
function getRuntime(): string {
  // @ts-ignore
  if (typeof Deno !== "undefined") {
    // @ts-ignore
    return `Deno ${Deno.version.deno}`;
  }
  // @ts-ignore
  if (typeof Bun !== "undefined") {
    // @ts-ignore
    return `Bun ${Bun.version}`;
  }
  return `Node ${process.version}`;
}

// Request tracker for C-MOVE/C-STORE correlation
class RequestTracker {
  private pendingRequests = new Map<string, {
    studyUID: string;
    seriesUID?: string;
    sopUID?: string;
    expectedCount?: number;
    receivedCount: number;
    datasets: any[];
    resolve: (datasets: any[]) => void;
    reject: (error: Error) => void;
  }>();

  registerRequest(
    studyUID: string,
    seriesUID?: string,
    sopUID?: string
  ): { id: string; promise: Promise<any[]> } {
    const id = crypto.randomUUID();

    const promise = new Promise<any[]>((resolve, reject) => {
      this.pendingRequests.set(id, {
        studyUID,
        seriesUID,
        sopUID,
        receivedCount: 0,
        datasets: [],
        resolve,
        reject,
      });
    });

    return { id, promise };
  }

  setExpectedCount(id: string, count: number): void {
    const request = this.pendingRequests.get(id);
    if (request) {
      request.expectedCount = count;

      if (request.receivedCount >= count) {
        this.completeRequest(id);
      }
    }
  }

  validateCStore(studyUID: string, seriesUID?: string, sopUID?: string): string | null {
    for (const [id, request] of this.pendingRequests) {
      if (request.studyUID === studyUID) {
        if (request.seriesUID && request.seriesUID !== seriesUID) continue;
        if (request.sopUID && request.sopUID !== sopUID) continue;
        return id;
      }
    }
    return null;
  }

  processCStore(id: string, dataset: any): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;

    request.datasets.push(dataset);
    request.receivedCount++;

    if (request.expectedCount && request.receivedCount >= request.expectedCount) {
      this.completeRequest(id);
    }
  }

  completeRequest(id: string): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;

    request.resolve(request.datasets);
    this.pendingRequests.delete(id);
  }

  markMoveCompleted(id: string): void {
    const request = this.pendingRequests.get(id);
    if (!request) return;

    this.completeRequest(id);
  }
}

// Global state
let activeScpInstances = new Set<any>();
let scpConnectionCount = 0;
let tracker: RequestTracker;

// Custom SCP for handling C-STORE requests
class TestScp extends Scp {
  static scpAet: string;

  constructor(socket: any, opts?: any) {
    super(socket, opts);
    ++scpConnectionCount;
    activeScpInstances.add(this);

    if (socket) {
      socket.on('close', () => {
        activeScpInstances.delete(this);
      });
    }
  }

  associationRequested(association: any): void {
    const contexts = association.getPresentationContexts();
    contexts.forEach((c: any) => {
      const context = association.getPresentationContext(c.id);
      const abstractSyntax = context.getAbstractSyntaxUid();
      const transferSyntaxes = context.getTransferSyntaxUids();

      if (
        abstractSyntax === SopClass.Verification ||
        Object.values(StorageClass).includes(abstractSyntax)
      ) {
        const preferredSyntaxes = [
          TransferSyntax.ExplicitVRLittleEndian,
          TransferSyntax.ImplicitVRLittleEndian,
          TransferSyntax.ExplicitVRBigEndian,
        ];

        let acceptedTransferSyntax = null;
        for (const preferredSyntax of preferredSyntaxes) {
          if (transferSyntaxes.includes(preferredSyntax)) {
            acceptedTransferSyntax = preferredSyntax;
            break;
          }
        }

        if (!acceptedTransferSyntax && transferSyntaxes.length > 0) {
          acceptedTransferSyntax = transferSyntaxes[0];
        }

        if (acceptedTransferSyntax) {
          context.setResult(PresentationContextResult.Accept, acceptedTransferSyntax);
        } else {
          context.setResult(PresentationContextResult.RejectTransferSyntaxesNotSupported);
        }
      } else {
        context.setResult(PresentationContextResult.RejectAbstractSyntaxNotSupported);
      }
    });

    // @ts-ignore - Method exists on base Scp class
    this.sendAssociationAccept();
  }

  cEchoRequest(request: any, callback: Function): void {
    const response = CEchoResponse.fromRequest(request);
    response.setStatus(Status.Success);
    callback(response);
  }

  cStoreRequest(request: any, callback: Function): void {
    const dataset = request.getDataset();
    let studyUID: string | undefined;
    let seriesUID: string | undefined;
    let sopUID: string | undefined;

    if (dataset && dataset.getElements) {
      const elements = dataset.getElements();
      studyUID = elements["StudyInstanceUID"] as string;
      seriesUID = elements["SeriesInstanceUID"] as string;
      sopUID = elements["SOPInstanceUID"] as string;
    }

    const requestId = tracker.validateCStore(studyUID!, seriesUID, sopUID);
    const response = CStoreResponse.fromRequest(request);

    if (!requestId) {
      response.setStatus(Status.NotAuthorized);
      callback(response);
      return;
    }

    tracker.processCStore(requestId, dataset);
    response.setStatus(Status.Success);
    callback(response);
  }

  associationReleaseRequested(): void {
    // @ts-ignore - Method exists on base Scp class
    this.sendAssociationReleaseResponse();
  }
}

// Track active clients
const activeClients = new Set<any>();

// Perform C-MOVE for a single instance
async function moveInstance(
  studyUID: string,
  seriesUID: string,
  sopUID: string,
  iteration: number
): Promise<{ success: boolean; status?: number; error?: string }> {
  const { id, promise } = tracker.registerRequest(studyUID, seriesUID, sopUID);

  const client = new Client();
  activeClients.add(client);

  let moveError: string | undefined;
  let moveStatus: number | undefined;
  let moveCompleted = false;
  let expectedInstancesSet = false;

  const sendMoveRequest = new Promise<void>((resolve, reject) => {
    const request = CMoveRequest.createImageMoveRequest(
      CONFIG.scpAet,
      studyUID,
      seriesUID,
      sopUID
    );

    (request as any).on("response", (response: any) => {
      const status = response.getStatus();

      if (status === Status.Pending) {
        const remaining = response.getRemaining?.() || 0;
        const completed = response.getCompleted?.() || 0;
        const failed = response.getFailures?.() || 0;
        const warnings = response.getWarnings?.() || 0;
        const totalExpected = remaining + completed + failed + warnings;

        if (!expectedInstancesSet && totalExpected > 0) {
          tracker.setExpectedCount(id, totalExpected);
          expectedInstancesSet = true;
        }
      } else if (status === Status.Success) {
        moveCompleted = true;
        moveStatus = status;

        if (!expectedInstancesSet) {
          const finalCompleted = response.getCompleted?.() || 1;
          tracker.setExpectedCount(id, finalCompleted);
          expectedInstancesSet = true;
        }
      } else {
        // Non-success, non-pending status - this is an error
        moveStatus = status;
        moveError = `C-MOVE failed with status: ${status}`;

        // Status 42754 is the specific error we're looking for
        if (status === 42754) {
          console.error(`\n❌ LEAK DETECTED at iteration ${iteration}!`);
          console.error(`   Status 42754 indicates TCP connection backlog exhaustion`);
        }
      }
    });

    (client as any).on("closed", () => {
      activeClients.delete(client);

      if (moveError) {
        reject(new Error(moveError));
      } else {
        if (moveCompleted) {
          tracker.markMoveCompleted(id);
        }
        resolve();
      }
    });

    (client as any).on("networkError", (e: Error) => {
      moveError = `Network error: ${e.message}`;
    });

    client.addRequest(request);
    client.send(
      CONFIG.orthancHost,
      CONFIG.orthancPort,
      CONFIG.scpAet,
      CONFIG.orthancAet
    );
  });

  try {
    await sendMoveRequest;
    const datasets = await promise;

    // Small delay to ensure cleanup
    await setTimeout(10);

    return {
      success: datasets && datasets.length > 0,
      status: moveStatus,
    };
  } catch (error) {
    return {
      success: false,
      status: moveStatus,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Wait for service to be healthy
 */
async function waitForService(url: string, timeout: number = 30000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        console.log(`✅ Service ${url} is healthy`);
        return;
      }
    } catch (error) {
      // Service not ready yet, continue waiting
    }

    await setTimeout(2000); // Wait 2 seconds before retry
  }

  throw new Error(`Service ${url} failed to become healthy within ${timeout}ms`);
}

/**
 * Get test DICOM files
 */
function getTestDicomFiles(): string[] {
  try {
    if (!existsSync(CONFIG.testDataDir)) {
      console.log(`⚠️  Test data directory not found: ${CONFIG.testDataDir}`);
      return [];
    }

    const files = readdirSync(CONFIG.testDataDir);
    const dicomFiles = files.filter(file => file.toLowerCase().endsWith('.dcm'));
    console.log(`📁 Found ${dicomFiles.length} DICOM files: ${dicomFiles.join(', ')}`);
    return dicomFiles;
  } catch (error) {
    console.error('❌ Error reading test data directory:', error);
    return [];
  }
}

/**
 * Ensure E2E test environment is running
 */
async function ensureTestEnvironment(): Promise<boolean> {
  if (!CONFIG.autoSetup) {
    console.log('⚠️  Auto-setup disabled, assuming Orthanc is already running');
    return true;
  }

  console.log('🔍 Checking E2E test environment...');

  try {
    // Check if services are already running
    try {
      await waitForService(`${CONFIG.orthancHttpUrl}/system`, 5000);
      console.log('✅ Orthanc is already running!');
      return true;
    } catch {
      // Services not running, need to start them
      console.log('🚀 Starting E2E test environment...');
    }

    // Start services in detached mode
    execSync('docker compose -f docker-compose.e2e.yml up -d --build orthanc', {
      stdio: 'inherit',
      timeout: 120000, // 2 minutes for building and starting
      cwd: join(__dirname, '..') // Project root
    });

    console.log('⏳ Waiting for Orthanc to be healthy...');

    // Wait for Orthanc to be ready
    await waitForService(`${CONFIG.orthancHttpUrl}/system`, CONFIG.startupTimeout);

    // Upload test DICOM files
    console.log('📁 Uploading test DICOM files...');
    const dicomFiles = getTestDicomFiles();

    if (dicomFiles.length === 0) {
      console.log('⚠️  No test DICOM files found, continuing anyway...');
      return true;
    }

    for (const fileName of dicomFiles) {
      try {
        const filePath = join(CONFIG.testDataDir, fileName);
        const fileBuffer = readFileSync(filePath);
        const uploadResponse = await fetch(`${CONFIG.orthancHttpUrl}/instances`, {
          method: 'POST',
          body: fileBuffer,
          headers: {
            'Content-Type': 'application/dicom'
          }
        });
        if (uploadResponse.ok) {
          console.log(`✅ Uploaded ${fileName}`);
        } else {
          console.log(`⚠️  Failed to upload ${fileName}: ${uploadResponse.status}`);
        }
      } catch (error: any) {
        console.log(`⚠️  Error uploading ${fileName}:`, error.message);
      }
    }

    // Verify DICOM files were uploaded
    const response = await fetch(`${CONFIG.orthancHttpUrl}/studies`);
    if (response.ok) {
      const studies = await response.json();
      console.log(`✅ Found ${studies.length} studies in Orthanc`);
    }

    console.log('✅ E2E test environment is ready!');
    return true;

  } catch (error) {
    console.error('❌ Failed to start E2E test environment:', error);

    // Show logs for debugging
    try {
      console.log('\n📝 Docker Compose logs:');
      execSync('docker compose -f docker-compose.e2e.yml logs --tail=50', {
        stdio: 'inherit',
        cwd: join(__dirname, '..')
      });
    } catch (logError) {
      console.error('Failed to get logs:', logError);
    }

    return false;
  }
}

// Get a test instance from Orthanc
async function getTestInstance(): Promise<{
  studyUID: string;
  seriesUID: string;
  sopUID: string;
} | null> {
  try {
    // Get studies
    const studiesResponse = await fetch(`${CONFIG.orthancHttpUrl}/studies`);
    if (!studiesResponse.ok) {
      console.error(`❌ Failed to fetch studies: ${studiesResponse.status}`);
      return null;
    }
    const studies = await studiesResponse.json();

    if (!Array.isArray(studies) || studies.length === 0) {
      console.error("❌ No studies found in Orthanc");
      return null;
    }

    // Get study details
    const studyResponse = await fetch(`${CONFIG.orthancHttpUrl}/studies/${studies[0]}`);
    if (!studyResponse.ok) return null;
    const studyData = await studyResponse.json();
    const studyUID = studyData.MainDicomTags?.StudyInstanceUID;

    if (!studyUID) {
      console.error("❌ Could not get StudyInstanceUID");
      return null;
    }

    // Get series
    const seriesIds = studyData.Series || [];
    if (seriesIds.length === 0) {
      console.error("❌ No series found in study");
      return null;
    }

    const seriesResponse = await fetch(`${CONFIG.orthancHttpUrl}/series/${seriesIds[0]}`);
    if (!seriesResponse.ok) return null;
    const seriesData = await seriesResponse.json();
    const seriesUID = seriesData.MainDicomTags?.SeriesInstanceUID;

    if (!seriesUID) {
      console.error("❌ Could not get SeriesInstanceUID");
      return null;
    }

    // Get instance
    const instanceIds = seriesData.Instances || [];
    if (instanceIds.length === 0) {
      console.error("❌ No instances found in series");
      return null;
    }

    const instanceResponse = await fetch(`${CONFIG.orthancHttpUrl}/instances/${instanceIds[0]}`);
    if (!instanceResponse.ok) return null;
    const instanceData = await instanceResponse.json();
    const sopUID = instanceData.MainDicomTags?.SOPInstanceUID;

    if (!sopUID) {
      console.error("❌ Could not get SOPInstanceUID");
      return null;
    }

    return { studyUID, seriesUID, sopUID };
  } catch (error) {
    console.error("❌ Error fetching test instance:", error);
    return null;
  }
}

// Main test function
async function runTest(): Promise<number> {
  const runtime = getRuntime();

  console.log("=".repeat(80));
  console.log("Connection Leak Regression Test");
  console.log("=".repeat(80));
  console.log(`Runtime: ${runtime}`);
  console.log(`Iteration count: ${CONFIG.iterationCount}`);
  console.log(`Delay between requests: ${CONFIG.delayMs}ms`);
  console.log(`Orthanc: ${CONFIG.orthancAet}@${CONFIG.orthancHost}:${CONFIG.orthancPort}`);
  console.log(`SCP: ${CONFIG.scpAet}@0.0.0.0:${CONFIG.scpPort}`);
  console.log("=".repeat(80));

  // Initialize
  tracker = new RequestTracker();
  activeScpInstances = new Set<any>();
  scpConnectionCount = 0;

  // Start SCP server
  TestScp.scpAet = CONFIG.scpAet;
  const scpServer = new Server(TestScp);
  scpServer.listen(CONFIG.scpPort);

  console.log(`\n[SCP] Listening on port ${CONFIG.scpPort}\n`);

  // Give server time to start
  await setTimeout(1000);

  // Ensure test environment is running
  const setupSuccess = await ensureTestEnvironment();
  if (!setupSuccess) {
    console.error("\n❌ Failed to setup test environment");
    scpServer.close();
    return 1;
  }

  // Get test instance
  console.log("\n📋 Fetching test instance from Orthanc...");
  const testInstance = await getTestInstance();

  if (!testInstance) {
    console.error("\n❌ Failed to get test instance from Orthanc");
    console.error("   Make sure Orthanc is running and has test data");
    console.error(`   URL: ${CONFIG.orthancHttpUrl}`);
    console.error("\n   You can disable auto-setup with: AUTO_SETUP=false");
    scpServer.close();
    return 1;
  }

  console.log(`✅ Test instance selected:`);
  console.log(`   Study: ${testInstance.studyUID}`);
  console.log(`   Series: ${testInstance.seriesUID}`);
  console.log(`   SOP: ${testInstance.sopUID}`);

  // Track results
  let successCount = 0;
  let failureCount = 0;
  let firstFailureIteration = -1;
  let firstFailureStatus = -1;

  console.log("\n" + "=".repeat(80));
  console.log("Starting C-MOVE operations...");
  console.log("=".repeat(80));

  // Perform iterations
  for (let i = 0; i < CONFIG.iterationCount; i++) {
    const result = await moveInstance(
      testInstance.studyUID,
      testInstance.seriesUID,
      testInstance.sopUID,
      i + 1
    );

    if (result.success) {
      successCount++;
    } else {
      failureCount++;

      if (firstFailureIteration === -1) {
        firstFailureIteration = i + 1;
        firstFailureStatus = result.status || -1;

        console.error(`\n❌ First failure at iteration ${i + 1}`);
        console.error(`   Status: ${result.status}`);
        console.error(`   Error: ${result.error}`);

        if (result.status === 42754) {
          console.error(`\n🔴 CONNECTION LEAK CONFIRMED!`);
          console.error(`   Failed at iteration ${i + 1} with status 42754`);
          console.error(`   This matches the TCP backlog limit symptom`);
          break;
        }
      }
    }

    // Log progress every 50 iterations
    if ((i + 1) % 50 === 0 || i === CONFIG.iterationCount - 1) {
      console.log(`\n📊 Progress: ${i + 1}/${CONFIG.iterationCount}`);
      console.log(`   ✅ Successful: ${successCount}`);
      console.log(`   ❌ Failed: ${failureCount}`);
      console.log(`   🔌 Active clients: ${activeClients.size}`);
      console.log(`   🔌 Active SCP instances: ${activeScpInstances.size}`);
      console.log(`   🔌 Total SCP connections: ${scpConnectionCount}`);
    }

    // Delay before next request
    if (i < CONFIG.iterationCount - 1 && CONFIG.delayMs > 0) {
      await setTimeout(CONFIG.delayMs);
    }
  }

  // Final results
  console.log("\n" + "=".repeat(80));
  console.log("Test Completed!");
  console.log("=".repeat(80));
  console.log(`Runtime: ${runtime}`);
  console.log(`Total iterations: ${CONFIG.iterationCount}`);
  console.log(`✅ Successful:   ${successCount}`);
  console.log(`❌ Failed:       ${failureCount}`);

  if (firstFailureIteration > 0) {
    console.log(`\n⚠️  First failure at iteration: ${firstFailureIteration}`);
    console.log(`   Status: ${firstFailureStatus}`);
  }

  console.log(`\n🔌 Active C-MOVE clients: ${activeClients.size}`);
  console.log(`🔌 Active SCP instances: ${activeScpInstances.size}`);
  console.log(`🔌 Total SCP connections: ${scpConnectionCount}`);

  // Analysis
  console.log("\n" + "=".repeat(80));
  console.log("ANALYSIS");
  console.log("=".repeat(80));

  const hasLeak = firstFailureStatus === 42754;
  const hasActiveConnections = activeClients.size > 0 || activeScpInstances.size > 0;

  if (hasLeak) {
    console.log(`🔴 CONNECTION LEAK DETECTED!`);
    console.log(`   Failed at iteration ${firstFailureIteration} with status 42754`);
    console.log(`   This is the known bug in ${runtime}`);
  } else if (hasActiveConnections) {
    console.log(`⚠️  WARNING: Leaked connections detected`);
    console.log(`   Active clients: ${activeClients.size}`);
    console.log(`   Active SCP instances: ${activeScpInstances.size}`);
  } else if (failureCount > 0) {
    console.log(`⚠️  Some failures occurred but not the specific leak bug`);
  } else {
    console.log(`✅ No connection leaks detected!`);
    console.log(`   All ${successCount} iterations completed successfully`);
  }

  console.log("=".repeat(80) + "\n");

  // Cleanup
  scpServer.close();

  // Return exit code
  return hasLeak ? 2 : (failureCount > 0 ? 1 : 0);
}

// Run test
const exitCode = await runTest();
process.exit(exitCode);
