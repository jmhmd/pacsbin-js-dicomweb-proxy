# E2E Tests for DICOM Web Proxy

This directory contains end-to-end tests for the DICOM Web Proxy application using **Vitest** as the test runner and **Orthanc** as the test PACS server.

## Test Architecture

```
┌─────────────────┐    HTTP/HTTPS     ┌──────────────────┐    DIMSE/DICOMweb    ┌─────────────────┐
│   Vitest Tests  │ ──────────────→   │ DICOM Web Proxy  │ ──────────────────→  │  Orthanc PACS   │
│                 │                   │                  │                       │                 │
│ - QIDO queries  │                   │ - DIMSE mode     │                       │ - Auto-imports  │
│ - WADO requests │                   │ - DICOMweb mode  │                       │ - DIMSE server  │
│ - Error cases   │                   │ - Cache tests    │                       │ - DICOMweb API  │
└─────────────────┘                   └──────────────────┘                       └─────────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+
- npm or pnpm

### Install Dependencies

```bash
npm install
```

### Run E2E Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI (visual test runner)
npm run test:ui

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Test Environment

### Docker Services

The E2E tests use Docker Compose to orchestrate two services:

1. **Orthanc PACS** (`orthanc`)

   - Port 4242: DIMSE server
   - Port 8042: HTTP/DICOMweb API
   - Auto-imports DICOM files from `tests/e2e/test-data/`
   - Provides both DIMSE and DICOMweb endpoints for testing

2. **DICOM Web Proxy** (`dicomweb-proxy`)
   - Port 3006: Proxy HTTP server
   - Port 8888: Proxy DIMSE server
   - Configurable for both DIMSE and DICOMweb proxy modes

### Test Data

The following DICOM test files are automatically loaded into Orthanc:

| File      | Description         | Purpose                   |
| --------- | ------------------- | ------------------------- |
| `ebe.dcm` | Basic DICOM file    | Standard DICOM processing |
| `ele.dcm` | Enhanced DICOM      | Enhanced IOD testing      |
| `j2k.dcm` | JPEG2000 compressed | Compressed image handling |
| `pdf.dcm` | PDF encapsulated    | Non-image DICOM objects   |
| `sr.dcm`  | Structured report   | Document-based DICOM      |

## Test Scenarios

### DIMSE Proxy Mode Tests (`dimse-proxy.test.ts`)

Tests the proxy in DIMSE mode, where it translates DICOMweb requests to DIMSE:

- ✅ **Health & Status**: Ping, status, dashboard endpoints
- ✅ **C-ECHO Tests**: DIMSE connectivity verification
- ✅ **QIDO-RS**: Study/Series/Instance metadata queries
- ✅ **WADO-RS**: Study/Series/Instance retrieval
- ✅ **Cache Tests**: Verify caching behavior and performance
- ✅ **File Type Tests**: Handle different DICOM file formats
- ✅ **Error Handling**: Invalid UIDs, missing resources

### DICOMweb Proxy Mode Tests (`dicomweb-proxy.test.ts`)

Tests the proxy in DICOMweb forwarding mode:

- ✅ **Request Forwarding**: Proxy DICOMweb requests to upstream server
- ✅ **CORS Handling**: Verify CORS headers are added
- ✅ **Error Forwarding**: Upstream errors are properly relayed
- ✅ **Performance**: Minimal latency overhead
- ✅ **Preflight Requests**: OPTIONS request handling

## Configuration

### Test Configuration Files

- `tests/e2e/config/test-config.jsonc`: Proxy configuration for testing
- `tests/e2e/orthanc-config/orthanc.json`: Orthanc PACS configuration
- `docker-compose.e2e.yml`: Docker orchestration for test environment

### Environment Variables

The test setup uses these configuration constants:

```typescript
export const TEST_CONFIG = {
  PROXY_URL: "http://localhost:3006",
  ORTHANC_URL: "http://localhost:8042",
  ORTHANC_DICOM_PORT: 4242,
  ORTHANC_AET: "ORTHANC",
  PROXY_AET: "DICOM_WEB_PROXY",

  STARTUP_TIMEOUT: 60000,
  REQUEST_TIMEOUT: 30000,
  SHUTDOWN_TIMEOUT: 30000,
};
```

## Test Lifecycle

### Setup Phase (beforeAll)

1. **Docker Compose Up**: Start Orthanc and proxy containers
2. **Health Checks**: Wait for services to be healthy
3. **Data Import**: Wait for DICOM files to be auto-imported
4. **Verification**: Confirm test data is available

### Test Execution

- Tests run sequentially to avoid port conflicts
- Each test is isolated and stateless
- Network requests use reasonable timeouts

### Cleanup Phase (afterAll)

1. **Container Shutdown**: Stop all Docker services
2. **Volume Cleanup**: Remove temporary data volumes
3. **Network Cleanup**: Remove Docker networks

## Debugging Tests

### View Service Logs

```bash
# All services
docker compose -f docker-compose.e2e.yml logs

# Specific service
docker compose -f docker-compose.e2e.yml logs orthanc
docker compose -f docker-compose.e2e.yml logs dicomweb-proxy
```

### Connect to Running Containers

```bash
# Orthanc container
docker compose -f docker-compose.e2e.yml exec orthanc bash

# Proxy container
docker compose -f docker-compose.e2e.yml exec dicomweb-proxy sh
```

### Manual Service Testing

```bash
# Start services without tests
docker compose -f docker-compose.e2e.yml up -d

# Test endpoints manually
curl http://localhost:8042/system        # Orthanc health
curl http://localhost:3006/ping          # Proxy health
curl http://localhost:8042/studies       # Orthanc studies
curl http://localhost:3006/studies       # Proxy studies

# Cleanup when done
docker compose -f docker-compose.e2e.yml down -v
```

### Test Debugging

```bash
# Run specific test file
npx vitest tests/e2e/dimse-proxy.test.ts

# Run with verbose output
npx vitest tests/e2e/dimse-proxy.test.ts --reporter=verbose

# Debug with console output
npx vitest tests/e2e/dimse-proxy.test.ts --reporter=basic
```

## Performance Considerations

### Test Duration

- Full E2E suite: ~3-5 minutes
- Container startup: ~30-60 seconds
- Individual tests: 1-10 seconds each

### Resource Usage

- Docker containers: ~500MB RAM
- Test data: ~5-10MB DICOM files
- Network ports: 3006, 4242, 8042, 8888

### Optimization Tips

- Use `test:watch` during development for faster feedback
- Run specific test files instead of full suite when debugging
- Keep Docker images pulled locally to reduce startup time

## Extending Tests

### Adding New Test Scenarios

1. Create test file in `tests/e2e/`
2. Import `TEST_CONFIG` from `../setup`
3. Use `describe()` and `test()` from Vitest
4. Follow existing patterns for HTTP requests and assertions

### Adding New DICOM Test Data

1. Place `.dcm` files in `tests/e2e/test-data/`
2. Restart test environment to auto-import
3. Files will be available in Orthanc automatically

### Testing Different Configurations

1. Modify `tests/e2e/config/test-config.jsonc`
2. Restart containers: `docker compose -f docker-compose.e2e.yml restart`
3. Tests will use new configuration

## Troubleshooting

### Common Issues

**Services Won't Start**

- Check Docker is running and has sufficient resources
- Verify no port conflicts (3006, 4242, 8042, 8888)
- Check Docker Compose logs for specific errors

**Tests Timeout**

- Increase timeouts in `vitest.config.ts`
- Verify services are healthy before tests run
- Check network connectivity between containers

**DICOM Files Not Loading**

- Verify files exist in `tests/e2e/test-data/`
- Check Orthanc logs for import errors
- Ensure files are valid DICOM format

**Configuration Issues**

- Validate JSON syntax in config files
- Check file paths and permissions
- Verify Docker volume mounts are correct

### Getting Help

1. Check service logs first: `docker compose -f docker-compose.e2e.yml logs`
2. Verify services are healthy: `curl http://localhost:3006/ping`
3. Test Orthanc directly: `curl http://localhost:8042/system`
4. Run tests with verbose output: `npx vitest --reporter=verbose`

The E2E test suite provides comprehensive validation of the DICOM Web Proxy's core functionality across both operational modes, ensuring reliable behavior in real-world hospital environments.
