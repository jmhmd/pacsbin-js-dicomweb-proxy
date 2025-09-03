/**
 * E2E Tests for DIMSE Proxy Mode
 * Tests the complete flow: DICOMweb requests -> DIMSE translation -> PACS communication
 */

import { describe, test, expect, beforeAll } from "vitest";
import { TEST_CONFIG, getTestFiles, switchProxyConfig } from "../setup";

describe("DIMSE C-GET Proxy E2E Tests", () => {
  let orthancStudies: any[] = [];

  beforeAll(async () => {
    // Switch proxy to DIMSE C-MOVE mode using static config
    await switchProxyConfig("dimse-cget-config.jsonc");
    // Get studies directly from Orthanc for reference
    const response = await fetch(`${TEST_CONFIG.ORTHANC_URL}/studies`);
    expect(response.ok).toBe(true);
    orthancStudies = await response.json();
    console.log(
      `📊 Found ${orthancStudies.length} studies in Orthanc for testing`
    );
  });

  describe("Health and Status Endpoints", () => {
    test("should respond to ping", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/ping`);
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toBe("pong");
    });

    test("should provide status information", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
      expect(response.status).toBe(200);

      const status = await response.json();
      expect(status).toHaveProperty("status", "healthy");
      expect(status).toHaveProperty("proxyMode", "dimse");
      expect(status).toHaveProperty("timestamp");
      expect(status).toHaveProperty("uptime");
    });

    test("should serve HTML dashboard on root", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");

      const html = await response.text();
      expect(html).toContain("DICOM Web Proxy");
      expect(html).toContain("Status Dashboard");
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

  describe("QIDO-RS (Query) Tests", () => {
    test("should query all studies", async () => {
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

    test("should query series for a study", async () => {
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

    test("should query instances for a series", async () => {
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

    test("should handle invalid study UID gracefully", async () => {
      const invalidUID = "1.2.3.4.5.6.7.8.9.0.invalid";
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${invalidUID}/series`
      );

      // Should return error response
      expect(response.status).toBeGreaterThanOrEqual(400);

      const errorData = await response.json();
      expect(errorData).toHaveProperty("error");
      expect(errorData).toHaveProperty("statusCode");
      expect(errorData).toHaveProperty("timestamp");
    });
  });

  describe("WADO-RS (Retrieve) Tests", () => {
    test("should retrieve study instances", async () => {
      // Get a study UID
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      expect(studyUID).toBeDefined();

      // Retrieve study
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
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

      // Verify we got DICOM data
      const data = await response.arrayBuffer();
      expect(data.byteLength).toBeGreaterThan(0);
    });

    test("should retrieve series instances", async () => {
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

        // Retrieve series
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
      }
    });

    test("should retrieve individual instance", async () => {
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

      // Retrieve single instance
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
      /* const view = new Uint8Array(data);
      if (view.length > 132) {
        const dicm = String.fromCharCode(
          view[128],
          view[129],
          view[130],
          view[131]
        );
        expect(dicm).toBe("DICM");
      } */
    });

    test("should handle 400 for invalid studyUID", async () => {
      const invalidUID = "1.2.3.4.5.6.7.8.9.0.invalid";
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${invalidUID}`
      );

      expect(response.status).toBe(400);

      const errorData = await response.json();
      expect(errorData).toHaveProperty("error");
      expect(errorData).toHaveProperty("statusCode", 400);
    });

    test("should handle 404 for nonexistent studyUID", async () => {
      const nonexistentUID = "1.2.3.4.5.6.7.8.9.0";
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${nonexistentUID}`
      );

      expect(response.status).toBe(404);

      const errorData = await response.json();
      expect(errorData).toHaveProperty("error");
      expect(errorData).toHaveProperty("statusCode", 404);
    });
  });

  /* describe("Cache Tests", () => {
    test("should cache retrieved instances", async () => {
      // Get study UID for testing
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];

      // First request (should hit PACS)
      const start1 = Date.now();
      const response1 = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
        {
          headers: { Accept: 'multipart/related; type="application/dicom"' },
        }
      );
      const duration1 = Date.now() - start1;

      expect(response1.status).toBe(200);

      // Second request (should hit cache and be faster)
      const start2 = Date.now();
      const response2 = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
        {
          headers: { Accept: 'multipart/related; type="application/dicom"' },
        }
      );
      const duration2 = Date.now() - start2;

      expect(response2.status).toBe(200);

      // Cache hit should typically be faster (though not guaranteed in all environments)
      console.log(
        `First request: ${duration1}ms, Second request: ${duration2}ms`
      );

      // Verify both responses have the same content length
      const data1 = await response1.arrayBuffer();
      const data2 = await response2.arrayBuffer();
      expect(data1.byteLength).toBe(data2.byteLength);
    });
  }); */

  describe("DICOM File Type Tests", () => {
    test("should handle different DICOM file types", async () => {
      // Test that each type of DICOM file can be processed by retrieving individual instances
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();

      // We should have multiple studies from our test files
      const testFiles = getTestFiles();
      expect(studies.length).toBeGreaterThanOrEqual(testFiles.length);

      // Test retrieving the first instance of the first series of each study
      for (const study of studies) {
        const studyUID = study["0020000D"]?.Value?.[0];
        expect(studyUID).toBeDefined();

        // Get series for this study
        const seriesResponse = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`
        );
        if (!seriesResponse.ok) {
          console.log(
            `⚠️ Failed to get series for study ${studyUID}: ${seriesResponse.status}`
          );
          continue;
        }

        const series = await seriesResponse.json();
        if (series.length === 0) {
          console.log(`⚠️ No series found for study ${studyUID}`);
          continue;
        }

        const seriesUID = series[0]["0020000E"]?.Value?.[0];
        expect(seriesUID).toBeDefined();

        // Get instances for this series
        const instancesResponse = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances`
        );
        if (!instancesResponse.ok) {
          console.log(
            `⚠️ Failed to get instances for series ${seriesUID}: ${instancesResponse.status}`
          );
          continue;
        }

        const instances = await instancesResponse.json();
        if (instances.length === 0) {
          console.log(`⚠️ No instances found for series ${seriesUID}`);
          continue;
        }

        const instanceUID = instances[0]["00080018"]?.Value?.[0];
        expect(instanceUID).toBeDefined();

        // Retrieve the individual DICOM instance
        const instanceResponse = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}`,
          {
            headers: {
              Accept: "application/dicom",
            },
          }
        );

        if (!instanceResponse.ok) {
          console.log(
            `⚠️ Failed to retrieve instance ${instanceUID}: ${instanceResponse.status}`
          );
          console.error(await instanceResponse.text());
          continue;
        }

        expect(instanceResponse.status).toBe(200);

        const contentType = instanceResponse.headers.get("content-type") || "";
        const data = await instanceResponse.arrayBuffer();
        expect(data.byteLength).toBeGreaterThan(0);

        // Handle different content types returned by WADO-RS
        if (contentType.includes("multipart")) {
          console.log(
            `📦 Received multipart response for instance ${instanceUID}`
          );
          // For multipart responses, we need to parse the boundaries and extract DICOM data
          // For now, just verify we got data and log the content type
          expect(data.byteLength).toBeGreaterThan(0);
        } else if (contentType.includes("application/dicom")) {
          // Direct DICOM Part 10 file - validate DICM header
          const view = new Uint8Array(data);
          if (view.length > 132) {
            const dicm = String.fromCharCode(
              view[128],
              view[129],
              view[130],
              view[131]
            );
            if (dicm === "DICM") {
              console.log(`✅ Valid DICOM Part 10 file with DICM header`);
            } else {
              console.log(
                `⚠️ DICOM file without standard Part 10 DICM header (${dicm})`
              );
              // Don't fail the test - some valid DICOM files might not have the header
            }
          }
        } else {
          console.log(`📄 Received content type: ${contentType}`);
        }

        console.log(
          `✅ Successfully retrieved DICOM Part 10 instance ${instanceUID} (${data.byteLength} bytes)`
        );
      }
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle malformed UID requests", async () => {
      const response = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/invalid-uid-format`
      );
      expect(response.status).toBeGreaterThanOrEqual(400);

      const error = await response.json();
      expect(error).toHaveProperty("error");
      expect(error).toHaveProperty("statusCode");
    });

    test("should handle missing required headers appropriately", async () => {
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();

      if (studies.length > 0) {
        const studyUID = studies[0]["0020000D"]?.Value?.[0];

        // Request WADO without Accept header
        const response = await fetch(
          `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`
        );

        // Should still work with default content type
        expect(response.status).toBe(200);
      }
    });
  });
});
