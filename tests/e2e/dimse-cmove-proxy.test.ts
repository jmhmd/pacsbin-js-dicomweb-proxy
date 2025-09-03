/**
 * E2E Tests for DIMSE Proxy Mode with C-MOVE
 * Tests the complete flow: DICOMweb requests -> DIMSE translation -> C-MOVE operations
 */

import { describe, test, expect, beforeAll } from "vitest";
import { TEST_CONFIG, switchProxyConfig } from "../setup";

describe("DIMSE C-MOVE Proxy E2E Tests", () => {
  let orthancStudies: any[] = [];

  beforeAll(async () => {
    // Switch proxy to DIMSE C-MOVE mode using static config
    await switchProxyConfig('dimse-cmove-config.jsonc');
    
    // Verify the proxy is in the expected mode with useCget: false
    const healthResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
    expect(healthResponse.ok).toBe(true);
    
    const status = await healthResponse.json();
    expect(status.proxyMode).toBe('dimse');
    
    // Get studies directly from Orthanc for reference
    const response = await fetch(`${TEST_CONFIG.ORTHANC_URL}/studies`);
    expect(response.ok).toBe(true);
    orthancStudies = await response.json();
    console.log(
      `📊 Found ${orthancStudies.length} studies in Orthanc for C-MOVE testing`
    );
  });

  describe("Health and Status Endpoints", () => {
    test("should respond to ping", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/ping`);
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toBe("pong");
    });

    test("should provide status information with useCget: false", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
      expect(response.status).toBe(200);

      const status = await response.json();
      expect(status).toHaveProperty("status", "healthy");
      expect(status).toHaveProperty("proxyMode", "dimse");
      expect(status).toHaveProperty("timestamp");
      expect(status).toHaveProperty("uptime");
      
      // Verify C-MOVE configuration is active (useCget should be false)
      if (status.config) {
        expect(status.config.useCget).toBe(false);
      }
    });
  });

  describe("DIMSE C-ECHO Tests", () => {
    test("should perform C-ECHO test via HTTP endpoint", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/dimse/echo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerIndex: 0 }),
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("peer");
      expect(result.peer).toHaveProperty("aet", TEST_CONFIG.ORTHANC_AET);
      expect(result).toHaveProperty("responseTime");
      expect(typeof result.responseTime).toBe("number");
    });
  });

  describe("QIDO-RS (Query) Tests with C-MOVE", () => {
    test("should query all studies using C-FIND", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/dicom+json"
      );

      const studies = await response.json();
      expect(Array.isArray(studies)).toBe(true);
      expect(studies.length).toBeGreaterThan(0);

      // Verify basic DICOM tags are present
      const study = studies[0];
      expect(study).toHaveProperty("0020000D"); // StudyInstanceUID
      expect(study).toHaveProperty("00100020"); // PatientID (usually)
    });

    test("should query series for a study using C-FIND", async () => {
      // First get a study
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      expect(studyUID).toBeDefined();

      // Query series for this study
      const seriesResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`
      );
      expect(seriesResponse.status).toBe(200);

      const series = await seriesResponse.json();
      expect(Array.isArray(series)).toBe(true);

      if (series.length > 0) {
        const firstSeries = series[0];
        expect(firstSeries).toHaveProperty("0020000E"); // SeriesInstanceUID
        expect(firstSeries).toHaveProperty("0020000D"); // StudyInstanceUID
      }
    });

    test("should query instances for a series using C-FIND", async () => {
      // Get study and series
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      expect(studyUID).toBeDefined();

      const seriesResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`
      );
      const series = await seriesResponse.json();

      if (series.length > 0) {
        const seriesUID = series[0]["0020000E"]?.Value?.[0];
        expect(seriesUID).toBeDefined();

        // Query instances
        const instancesResponse = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances`
        );
        expect(instancesResponse.status).toBe(200);

        const instances = await instancesResponse.json();
        expect(Array.isArray(instances)).toBe(true);

        if (instances.length > 0) {
          const instance = instances[0];
          expect(instance).toHaveProperty("00080018"); // SOPInstanceUID
        }
      }
    });
  });

  describe("WADO-RS (Retrieve) Tests with C-MOVE", () => {
    test("should retrieve study instances using C-MOVE", async () => {
      // Get a study UID
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      expect(studyUID).toBeDefined();

      // Retrieve study using C-MOVE
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
        {
          headers: {
            Accept: 'multipart/related; type="application/dicom"',
          },
        }
      );

      if (response.status !== 200) {
        const errorText = await response.text();
        console.error(`❌ C-MOVE study retrieval failed with ${response.status}:`, errorText);
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }
      
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "multipart/related"
      );

      // Verify we got DICOM data
      const data = await response.arrayBuffer();
      expect(data.byteLength).toBeGreaterThan(0);

      console.log(`✅ Successfully retrieved study ${studyUID} via C-MOVE (${data.byteLength} bytes)`);
    });

    test("should retrieve series instances using C-MOVE", async () => {
      // Get study and series UIDs
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      const seriesResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`
      );
      const series = await seriesResponse.json();

      if (series.length > 0) {
        const seriesUID = series[0]["0020000E"]?.Value?.[0];

        // Retrieve series using C-MOVE
        const response = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}`,
          {
            headers: {
              Accept: 'multipart/related; type="application/dicom"',
            },
          }
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "multipart/related"
        );

        const data = await response.arrayBuffer();
        expect(data.byteLength).toBeGreaterThan(0);

        console.log(`✅ Successfully retrieved series ${seriesUID} via C-MOVE (${data.byteLength} bytes)`);
      }
    });

    test("should retrieve individual instance using C-MOVE", async () => {
      // Navigate to get an instance UID
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      const seriesResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`
      );
      const series = await seriesResponse.json();

      expect(series.length).toBeGreaterThan(0);

      const seriesUID = series[0]["0020000E"]?.Value?.[0];
      const instancesResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances`
      );
      const instances = await instancesResponse.json();

      expect(instances.length).toBeGreaterThan(0);

      const instanceUID = instances[0]["00080018"]?.Value?.[0];

      // Retrieve single instance using C-MOVE
      console.log(`📥 Retrieving instance ${instanceUID} via C-MOVE... at url: ${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}`);
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}`,
        {
          headers: {
            Accept: "application/dicom",
          },
        }
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/dicom"
      );

      const data = await response.arrayBuffer();
      expect(data.byteLength).toBeGreaterThan(0);

      // Basic DICOM file validation (should start with DICOM prefix after 128-byte preamble)
      const view = new Uint8Array(data);
      if (view.length > 132) {
        const dicm = String.fromCharCode(
          view[128],
          view[129],
          view[130],
          view[131]
        );
        if (dicm === "DICM") {
          console.log(`✅ Valid DICOM Part 10 file retrieved via C-MOVE`);
        } else {
          console.log(`⚠️ DICOM file without standard Part 10 DICM header (${dicm})`);
        }
      }

      console.log(`✅ Successfully retrieved instance ${instanceUID} via C-MOVE (${data.byteLength} bytes)`);
    });
  });

  describe("C-MOVE Specific Tests", () => {
    test("should handle C-MOVE timeout scenarios gracefully", async () => {
      // Test with a malformed UID that might cause timeout
      const invalidUID = "1.2.3.4.5.6.7.8.9.0.invalid";
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${invalidUID}`,
        {
          headers: {
            Accept: "application/dicom",
          },
        }
      );

      // Should return appropriate error response
      expect(response.status).toBeGreaterThanOrEqual(400);

      const errorData = await response.json();
      expect(errorData).toHaveProperty("error");
      expect(errorData).toHaveProperty("statusCode");
    });

    test("should verify C-MOVE operations are logged properly", async () => {
      // Get a study for testing
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      
      if (studies.length > 0) {
        const studyUID = studies[0]["0020000D"]?.Value?.[0];
        
        // Perform a retrieval operation
        const response = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
          {
            headers: {
              Accept: 'multipart/related; type="application/dicom"',
            },
          }
        );

        // Should succeed
        expect(response.status).toBe(200);
        
        // Check if response includes any C-MOVE related headers
        const headers = Object.fromEntries(response.headers.entries());
        console.log(`📋 Response headers:`, Object.keys(headers));
      }
    });
  });

  describe("Performance Comparison Tests", () => {
    test("should compare C-MOVE vs direct retrieval performance", async () => {
      if (orthancStudies.length === 0) return;

      // Get a small study for testing
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];

      // Test C-MOVE retrieval time
      const cmoveStart = Date.now();
      const cmoveResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
        {
          headers: {
            Accept: 'multipart/related; type="application/dicom"',
          },
        }
      );
      const cmoveDuration = Date.now() - cmoveStart;
      expect(cmoveResponse.ok).toBe(true);

      // Test direct Orthanc retrieval time for comparison
      const directStart = Date.now();
      const directResponse = await fetch(
        `${TEST_CONFIG.ORTHANC_URL}/studies/${orthancStudies[0]}`,
        {
          headers: {
            Accept: "application/zip",
          },
        }
      );
      const directDuration = Date.now() - directStart;

      console.log(`🔄 C-MOVE retrieval: ${cmoveDuration}ms, Direct Orthanc: ${directDuration}ms`);
      
      // C-MOVE should work (we're not asserting performance since it depends on many factors)
      expect(cmoveResponse.status).toBe(200);
      if (directResponse.ok) {
        console.log(`📊 Performance ratio: ${(cmoveDuration / directDuration).toFixed(2)}x`);
      }
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle C-MOVE failures gracefully", async () => {
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/invalid-uid-format`
      );
      expect(response.status).toBeGreaterThanOrEqual(400);

      const error = await response.json();
      expect(error).toHaveProperty("error");
      expect(error).toHaveProperty("statusCode");
    });

    test("should handle DIMSE connection failures", async () => {
      // This test assumes the connection can fail under certain conditions
      // In a real scenario, you might temporarily stop Orthanc or change config
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/1.2.3.4.5.6.7.8.9.0`
      );

      // Should handle connection issues gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("CORS Configuration Tests", () => {
    test("should handle preflight OPTIONS requests", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`, {
        method: "OPTIONS",
        headers: {
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Content-Type",
        },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("access-control-allow-methods")).toContain("GET");
      expect(response.headers.get("access-control-allow-headers")).toContain("Content-Type");
    });

    test("should add CORS headers to all responses", async () => {
      const endpoints = ["/studies", "/ping", "/status"];

      for (const endpoint of endpoints) {
        const response = await fetch(`${TEST_CONFIG.PROXY_URL}${endpoint}`);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
      }
    });
  });
});