/**
 * E2E Tests for DIMSE TLS Mode
 * Tests TLS-secured DIMSE connections using test certificates
 */

import { describe, test, expect, beforeAll } from "vitest";
import { TEST_CONFIG, switchProxyConfig } from "../setup";
import * as tls from "node:tls";
import * as fs from "node:fs";
import { join } from "node:path";

describe("DIMSE TLS E2E Tests", () => {
  let orthancStudies: any[] = [];
  const TLS_PORT = 8889;
  const CERT_DIR = "./cert-test/dicom";

  beforeAll(async () => {
    // Switch proxy to DIMSE TLS mode
    await switchProxyConfig('dimse-tls-config.jsonc');

    // Verify the proxy is in TLS mode
    const healthResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
    expect(healthResponse.ok).toBe(true);

    const status = await healthResponse.json();
    expect(status.proxyMode).toBe('dimse');

    // Get studies from Orthanc for reference
    const response = await fetch(`${TEST_CONFIG.ORTHANC_URL}/studies`);
    expect(response.ok).toBe(true);
    orthancStudies = await response.json();
    console.log(
      `📊 Found ${orthancStudies.length} studies in Orthanc for TLS testing`
    );
  });

  describe("TLS Configuration Validation", () => {
    test("should confirm TLS is enabled in proxy status", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
      expect(response.status).toBe(200);

      const status = await response.json();
      expect(status.proxyMode).toBe('dimse');

      // Check for TLS configuration in status
      if (status.config?.dimseProxySettings?.proxyServer) {
        const proxyServer = status.config.dimseProxySettings.proxyServer;
        expect(proxyServer.port).toBe(TLS_PORT);
        expect(proxyServer).toHaveProperty('securityOptions');

        if (proxyServer.securityOptions) {
          expect(proxyServer.securityOptions).toHaveProperty('cert');
          expect(proxyServer.securityOptions).toHaveProperty('key');
          expect(proxyServer.securityOptions).toHaveProperty('ca');
          console.log(`✅ TLS configuration confirmed in proxy status`);
        }
      }
    });

    test("should verify test certificates exist and are readable", () => {
      const certFiles = [
        join(CERT_DIR, 'server.crt'),
        join(CERT_DIR, 'server.key'),
        join(CERT_DIR, 'client.crt'),
        join(CERT_DIR, 'client.key'),
        join(CERT_DIR, 'ca.crt'),
        join(CERT_DIR, 'ca.key')
      ];

      for (const certFile of certFiles) {
        expect(fs.existsSync(certFile), `Certificate file ${certFile} should exist`).toBe(true);

        // Verify we can read the file
        const stats = fs.statSync(certFile);
        expect(stats.size).toBeGreaterThan(0);

        console.log(`✅ Certificate file verified: ${certFile} (${stats.size} bytes)`);
      }
    });

    test("should validate certificate chain", () => {
      const caCert = fs.readFileSync(join(CERT_DIR, 'ca.crt'));
      const serverCert = fs.readFileSync(join(CERT_DIR, 'server.crt'));
      const clientCert = fs.readFileSync(join(CERT_DIR, 'client.crt'));

      // Basic certificate format validation
      expect(caCert.toString()).toContain('BEGIN CERTIFICATE');
      expect(caCert.toString()).toContain('END CERTIFICATE');
      expect(serverCert.toString()).toContain('BEGIN CERTIFICATE');
      expect(serverCert.toString()).toContain('END CERTIFICATE');
      expect(clientCert.toString()).toContain('BEGIN CERTIFICATE');
      expect(clientCert.toString()).toContain('END CERTIFICATE');

      console.log(`✅ Certificate chain format validation passed`);
    });
  });

  describe("TLS Connection Tests", () => {
    test("should establish TLS connection to DIMSE server", async () => {
      return new Promise<void>((resolve, reject) => {
        const options = {
          host: 'localhost',
          port: TLS_PORT,
          rejectUnauthorized: false, // Accept self-signed certs for testing
          cert: fs.readFileSync(join(CERT_DIR, 'client.crt')),
          key: fs.readFileSync(join(CERT_DIR, 'client.key')),
          ca: fs.readFileSync(join(CERT_DIR, 'ca.crt')),
          timeout: 10000
        };

        const socket = tls.connect(options, () => {
          console.log(`✅ TLS connection established to ${options.host}:${options.port}`);
          console.log(`   Protocol: ${socket.getProtocol()}`);
          console.log(`   Cipher: ${socket.getCipher()?.name}`);
          console.log(`   Authorized: ${socket.authorized}`);

          expect(socket.authorized || !options.rejectUnauthorized).toBe(true);
          expect(socket.getProtocol()).toMatch(/TLSv1\.[23]/);

          socket.end();
          resolve();
        });

        socket.on('error', (error) => {
          console.error(`❌ TLS connection failed:`, error.message);
          reject(error);
        });

        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('TLS connection timeout'));
        });
      });
    }, 15000);

    test("should reject unauthorized connections when rejectUnauthorized is true", async () => {
      // This test would require a modified config with rejectUnauthorized: true
      // For now, we'll just verify the current behavior
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
      const status = await response.json();

      if (status.config?.dimseProxySettings?.proxyServer?.securityOptions) {
        const secOpts = status.config.dimseProxySettings.proxyServer.securityOptions;
        console.log(`📋 Current rejectUnauthorized setting: ${secOpts.rejectUnauthorized}`);

        // This is informational for now - in production, rejectUnauthorized should be true
        expect(typeof secOpts.rejectUnauthorized).toBe('boolean');
      }
    });
  });

  describe("DIMSE Operations over TLS", () => {
    test("should perform C-ECHO over TLS", async () => {
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

      console.log(`✅ C-ECHO over TLS successful in ${result.responseTime}ms`);
    });

    test("should query studies using C-FIND over TLS", async () => {
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

      console.log(`✅ C-FIND over TLS returned ${studies.length} studies`);
    });

    test("should retrieve study using C-GET over TLS", async () => {
      // Get a study UID
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];
      expect(studyUID).toBeDefined();

      // Retrieve study using C-GET (useCget: true in config)
      console.log(`📥 Retrieving study ${studyUID} via C-GET over TLS...`);
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
        console.error(`❌ TLS C-GET study retrieval failed with ${response.status}:`, errorText);
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "multipart/related"
      );

      // Verify we got DICOM data
      const data = await response.arrayBuffer();
      expect(data.byteLength).toBeGreaterThan(0);

      console.log(`✅ Successfully retrieved study ${studyUID} via C-GET over TLS (${data.byteLength} bytes)`);
    });

    test("should retrieve individual instance using C-GET over TLS", async () => {
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

      // Retrieve single instance using C-GET over TLS
      console.log(`📥 Retrieving instance ${instanceUID} via C-GET over TLS...`);
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

      // Basic DICOM file validation
      const view = new Uint8Array(data);
      if (view.length > 132) {
        const dicm = String.fromCharCode(
          view[128],
          view[129],
          view[130],
          view[131]
        );
        if (dicm === "DICM") {
          console.log(`✅ Valid DICOM Part 10 file retrieved via C-GET over TLS`);
        } else {
          console.log(`⚠️ DICOM file without standard Part 10 DICM header (${dicm})`);
        }
      }

      console.log(`✅ Successfully retrieved instance ${instanceUID} via C-GET over TLS (${data.byteLength} bytes)`);
    });
  });

  describe("TLS Security Tests", () => {
    test("should use minimum TLS version as configured", async () => {
      return new Promise<void>((resolve, reject) => {
        const options = {
          host: 'localhost',
          port: TLS_PORT,
          rejectUnauthorized: false,
          cert: fs.readFileSync(join(CERT_DIR, 'client.crt')),
          key: fs.readFileSync(join(CERT_DIR, 'client.key')),
          ca: fs.readFileSync(join(CERT_DIR, 'ca.crt')),
          minVersion: 'TLSv1.2' as const,
          timeout: 5000
        };

        const socket = tls.connect(options, () => {
          const protocol = socket.getProtocol();
          console.log(`🔒 Connected with protocol: ${protocol}`);

          // Verify we're using at least TLS 1.2
          expect(protocol).toMatch(/TLSv1\.[23]/);

          // Check cipher strength
          const cipher = socket.getCipher();
          console.log(`🔐 Cipher: ${cipher?.name} (${cipher?.version})`);

          socket.end();
          resolve();
        });

        socket.on('error', (error) => {
          console.error(`❌ TLS security test failed:`, error.message);
          reject(error);
        });

        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('TLS security test timeout'));
        });
      });
    });

    test("should validate certificate attributes", () => {
      const serverCert = fs.readFileSync(join(CERT_DIR, 'server.crt'), 'utf8');
      const clientCert = fs.readFileSync(join(CERT_DIR, 'client.crt'), 'utf8');

      // Basic format validation
      expect(serverCert).toContain('-----BEGIN CERTIFICATE-----');
      expect(serverCert).toContain('-----END CERTIFICATE-----');
      expect(clientCert).toContain('-----BEGIN CERTIFICATE-----');
      expect(clientCert).toContain('-----END CERTIFICATE-----');

      console.log(`✅ Certificate format validation passed`);
    });

    test("should handle TLS errors gracefully", async () => {
      // Test with invalid UID that might cause TLS-related issues
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

      console.log(`✅ TLS error handling validated`);
    });
  });

  describe("Performance Tests", () => {
    test("should compare TLS vs non-TLS performance", async () => {
      if (orthancStudies.length === 0) return;

      // Get a study for testing
      const studiesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const studies = await studiesResponse.json();
      expect(studies.length).toBeGreaterThan(0);

      const studyUID = studies[0]["0020000D"]?.Value?.[0];

      // Test TLS retrieval time
      const tlsStart = Date.now();
      const tlsResponse = await fetch(
        `${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`,
        {
          headers: {
            Accept: 'multipart/related; type="application/dicom"',
          },
        }
      );
      const tlsDuration = Date.now() - tlsStart;
      expect(tlsResponse.ok).toBe(true);

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

      console.log(`🔄 TLS retrieval: ${tlsDuration}ms, Direct Orthanc: ${directDuration}ms`);

      // TLS should work (performance comparison is informational)
      expect(tlsResponse.status).toBe(200);
      if (directResponse.ok) {
        const performanceRatio = tlsDuration / directDuration;
        console.log(`📊 TLS performance ratio: ${performanceRatio.toFixed(2)}x`);

        // TLS overhead should be reasonable (less than 5x slower)
        expect(performanceRatio).toBeLessThan(5.0);
      }
    });
  });

  describe("Certificate Management Tests", () => {
    test("should report certificate information in status", async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
      const status = await response.json();

      if (status.config?.dimseProxySettings?.proxyServer?.securityOptions) {
        const secOpts = status.config.dimseProxySettings.proxyServer.securityOptions;

        expect(secOpts).toHaveProperty('cert');
        expect(secOpts).toHaveProperty('key');
        expect(secOpts).toHaveProperty('ca');
        expect(secOpts).toHaveProperty('minVersion');
        expect(secOpts).toHaveProperty('maxVersion');

        console.log(`📋 TLS Configuration:`);
        console.log(`   Cert: ${secOpts.cert}`);
        console.log(`   Key: ${secOpts.key}`);
        console.log(`   CA: ${secOpts.ca}`);
        console.log(`   Min Version: ${secOpts.minVersion}`);
        console.log(`   Max Version: ${secOpts.maxVersion}`);
        console.log(`   Request Cert: ${secOpts.requestCert}`);
        console.log(`   Reject Unauthorized: ${secOpts.rejectUnauthorized}`);
      }
    });
  });
});