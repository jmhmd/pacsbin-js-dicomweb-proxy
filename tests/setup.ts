/**
 * Global test setup for E2E tests
 * This file runs before all test files
 */

import { beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Test environment configuration
export const TEST_CONFIG = {
  PROXY_URL: 'http://localhost:3006',
  ORTHANC_URL: 'http://localhost:8042',
  ORTHANC_DICOM_PORT: 4242,
  ORTHANC_AET: 'ORTHANC',
  PROXY_AET: 'DICOM_WEB_PROXY',
  
  // Test timeouts
  STARTUP_TIMEOUT: 60000,
  REQUEST_TIMEOUT: 30000,
  SHUTDOWN_TIMEOUT: 30000,
  
  // Test data directory
  TEST_DATA_DIR: './tests/e2e/test-data'
};

/**
 * Discover all DICOM files in the test data directory
 */
function getTestDicomFiles(): string[] {
  try {
    const files = readdirSync(TEST_CONFIG.TEST_DATA_DIR);
    const dicomFiles = files.filter(file => file.toLowerCase().endsWith('.dcm'));
    console.log(`📁 Found ${dicomFiles.length} DICOM files: ${dicomFiles.join(', ')}`);
    return dicomFiles;
  } catch (error) {
    console.error('❌ Error reading test data directory:', error);
    return [];
  }
}

/**
 * Wait for service to be healthy
 */
async function waitForService(url: string, timeout: number = 30000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      console.log('pinging service at ', url);
      const response = await fetch(url, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000) 
      });
      
      if (response.ok) {
        console.log(`✅ Service ${url} is healthy`);
        return;
      }
    } catch (error) {
      // console.log('error pinging service at ', url);
      // console.log(error);
      // Service not ready yet, continue waiting
    }
    
    await setTimeout(2000); // Wait 2 seconds before retry
  }
  
  throw new Error(`Service ${url} failed to become healthy within ${timeout}ms`);
}

/**
 * Check if services are running, if not start them
 */
async function ensureServicesRunning(): Promise<void> {
  console.log('🔍 Checking E2E test environment...');
  
  try {
    // Check if services are already running
    try {
      await waitForService(`${TEST_CONFIG.ORTHANC_URL}/system`, 5000);
      await waitForService(`${TEST_CONFIG.PROXY_URL}/ping`, 5000);
      console.log('✅ E2E test environment is already running!');
      return;
    } catch {
      // Services not running, need to start them
      console.log('🚀 Starting E2E test environment...');
    }
    
    // Start services in detached mode
    execSync('docker compose -f docker-compose.e2e.yml up -d --build', {
      stdio: 'inherit',
      timeout: 120000 // 2 minutes for building and starting
    });
    
    console.log('⏳ Waiting for services to be healthy...');
    
    // Wait for Orthanc to be ready
    await waitForService(`${TEST_CONFIG.ORTHANC_URL}/system`, TEST_CONFIG.STARTUP_TIMEOUT);

    // Wait for Proxy to be ready  
    await waitForService(`${TEST_CONFIG.PROXY_URL}/ping`, TEST_CONFIG.STARTUP_TIMEOUT);
    
    // Upload test DICOM files manually since auto-import may not be available
    console.log('📁 Uploading test DICOM files...');
    const dicomFiles = getTestDicomFiles();
    
    for (const fileName of dicomFiles) {
      try {
        const filePath = join(TEST_CONFIG.TEST_DATA_DIR, fileName);
        const fileBuffer = readFileSync(filePath);
        const uploadResponse = await fetch(`${TEST_CONFIG.ORTHANC_URL}/instances`, {
          method: 'POST',
          body: fileBuffer,
          headers: {
            'Content-Type': 'application/dicom'
          }
        });
        if (uploadResponse.ok) {
          console.log(`✅ Uploaded ${fileName}`);
        } else {
          console.log(`⚠️ Failed to upload ${fileName}: ${uploadResponse.status}`);
        }
      } catch (error) {
        console.log(`⚠️ Error uploading ${fileName}:`, error.message);
      }
    }
    
    // Verify DICOM files were uploaded
    const response = await fetch(`${TEST_CONFIG.ORTHANC_URL}/studies`);
    if (response.ok) {
      const studies = await response.json();
      console.log(`✅ Found ${studies.length} studies in Orthanc`);
    }
    
    console.log('✅ E2E test environment is ready!');
    
  } catch (error) {
    console.error('❌ Failed to start E2E test environment:', error);
    
    // Show logs for debugging
    try {
      console.log('\n📝 Docker Compose logs:');
      execSync('docker compose -f docker-compose.e2e.yml logs --tail=50', { stdio: 'inherit' });
    } catch (logError) {
      console.error('Failed to get logs:', logError);
    }
    
    throw error;
  }
}

/**
 * Stop Docker Compose services
 */
async function stopServices(): Promise<void> {
  console.log('🛑 Stopping E2E test environment...');
  
  try {
    execSync('docker compose -f docker-compose.e2e.yml down -v', {
      stdio: 'inherit',
      timeout: TEST_CONFIG.SHUTDOWN_TIMEOUT
    });
    console.log('✅ E2E test environment stopped');
  } catch (error) {
    console.error('❌ Failed to stop E2E test environment:', error);
    // Don't throw here, as cleanup should continue
  }
}

// Setup state to ensure we only start/stop services once
let isSetupComplete = false;
let isShuttingDown = false;

// Global setup hooks with singleton pattern
beforeAll(async () => {
  if (!isSetupComplete) {
    await ensureServicesRunning();
    isSetupComplete = true;
  }
}, TEST_CONFIG.STARTUP_TIMEOUT + 30000);

afterAll(async () => {
  if (!isShuttingDown) {
    isShuttingDown = true;
    await stopServices();
  }
}, TEST_CONFIG.SHUTDOWN_TIMEOUT);

// Export for use in individual tests  
export { waitForService, getTestDicomFiles };

// Export test files for backward compatibility with existing tests
export const getTestFiles = () => getTestDicomFiles();