/**
 * E2E Tests for DICOMweb Proxy Mode
 * Tests forwarding DICOMweb requests to upstream DICOMweb server (Orthanc)
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { TEST_CONFIG, switchProxyConfig } from '../setup';

describe('DICOMweb Proxy E2E Tests', () => {
  let orthancStudies: any[] = [];

  beforeAll(async () => {
    // Switch proxy to DICOMweb mode using static config
    await switchProxyConfig('dicomweb-proxy-config.jsonc');
    
    // Verify the proxy is in the expected mode
    const healthResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/status`);
    expect(healthResponse.ok).toBe(true);
    
    const status = await healthResponse.json();
    expect(status.proxyMode).toBe('dicomweb');

    // Get reference data from Orthanc
    const response = await fetch(`${TEST_CONFIG.ORTHANC_URL}/dicom-web/studies`);
    expect(response.ok).toBe(true);
    orthancStudies = await response.json();
    console.log(`📊 Found ${orthancStudies.length} studies in Orthanc DICOMweb endpoint`);
  });

  describe('DICOMweb Forwarding Tests', () => {
    test('should forward QIDO studies query', async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const studies = await response.json();
      expect(Array.isArray(studies)).toBe(true);
      expect(studies.length).toBeGreaterThan(0);
      
      // Should match what Orthanc returns directly
      expect(studies.length).toBe(orthancStudies.length);
      
      // Verify CORS headers are added
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    test('should forward QIDO series query', async () => {
      if (orthancStudies.length === 0) return;
      
      const studyUID = orthancStudies[0]['0020000D']?.Value?.[0];
      expect(studyUID).toBeDefined();
      
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`);
      expect(response.status).toBe(200);
      
      const series = await response.json();
      expect(Array.isArray(series)).toBe(true);
      
      // Verify CORS headers
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    test('should forward QIDO instances query', async () => {
      if (orthancStudies.length === 0) return;
      
      const studyUID = orthancStudies[0]['0020000D']?.Value?.[0];
      
      // Get series first
      const seriesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`);
      const series = await seriesResponse.json();
      
      if (series.length > 0) {
        const seriesUID = series[0]['0020000E']?.Value?.[0];
        
        const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances`);
        expect(response.status).toBe(200);
        
        const instances = await response.json();
        expect(Array.isArray(instances)).toBe(true);
        
        // Verify CORS headers
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
      }
    });

    test('should forward WADO-RS study retrieval', async () => {
      if (orthancStudies.length === 0) return;
      
      const studyUID = orthancStudies[0]['0020000D']?.Value?.[0];
      
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}`, {
        headers: {
          'Accept': 'multipart/related; type="application/dicom"'
        }
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('multipart/related');
      
      const data = await response.arrayBuffer();
      expect(data.byteLength).toBeGreaterThan(0);
      
      // Verify CORS headers
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    test('should forward WADO-RS instance retrieval', async () => {
      if (orthancStudies.length === 0) return;
      
      const studyUID = orthancStudies[0]['0020000D']?.Value?.[0];
      
      // Navigate to get instance UID
      const seriesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series`);
      const series = await seriesResponse.json();
      
      if (series.length > 0) {
        const seriesUID = series[0]['0020000E']?.Value?.[0];
        const instancesResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances`);
        const instances = await instancesResponse.json();
        
        if (instances.length > 0) {
          const instanceUID = instances[0]['00080018']?.Value?.[0];
          
          const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${studyUID}/series/${seriesUID}/instances/${instanceUID}`, {
            headers: {
              'Accept': 'application/dicom'
            }
          });
          
          expect(response.status).toBe(200);
          expect(response.headers.get('content-type')).toContain('application/dicom');
          
          const data = await response.arrayBuffer();
          expect(data.byteLength).toBeGreaterThan(0);
          
          // Verify CORS headers
          expect(response.headers.get('access-control-allow-origin')).toBe('*');
        }
      }
    });
  });

  describe('Error Forwarding Tests', () => {
    test('should forward 404 errors from upstream', async () => {
      const invalidUID = '1.2.3.4.5.6.7.8.9.0.invalid';
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/${invalidUID}`);
      
      expect(response.status).toBe(404);
      
      // Should still have CORS headers on error responses
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    test('should handle upstream server errors gracefully', async () => {
      // Test with malformed request that might cause upstream error
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies/malformed%20uid%20with%20spaces`);
      
      // Should get appropriate error response
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('CORS Configuration Tests', () => {
    test('should handle preflight OPTIONS requests', async () => {
      const response = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`, {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
      expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
    });

    test('should add CORS headers to all responses', async () => {
      const endpoints = [
        '/studies',
        '/ping',
        '/status'
      ];
      
      for (const endpoint of endpoints) {
        const response = await fetch(`${TEST_CONFIG.PROXY_URL}${endpoint}`);
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
      }
    });
  });

  describe('Performance Tests', () => {
    test('should forward requests with reasonable latency', async () => {
      // Test direct Orthanc vs proxy latency
      const directStart = Date.now();
      const directResponse = await fetch(`${TEST_CONFIG.ORTHANC_URL}/dicom-web/studies`);
      const directDuration = Date.now() - directStart;
      expect(directResponse.ok).toBe(true);
      
      const proxyStart = Date.now();
      const proxyResponse = await fetch(`${TEST_CONFIG.PROXY_URL}/studies`);
      const proxyDuration = Date.now() - proxyStart;
      expect(proxyResponse.ok).toBe(true);
      
      console.log(`Direct Orthanc: ${directDuration}ms, Proxy: ${proxyDuration}ms`);
      
      // Proxy should add minimal overhead (allowing 5x latency as reasonable upper bound)
      expect(proxyDuration).toBeLessThan(directDuration * 5);
    });
  });
});