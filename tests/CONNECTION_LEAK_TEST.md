# Connection Leak Regression Test

Standalone test to reproduce and validate fixes for a TCP connection leak bug discovered in Deno 2.4.1-2.5.2 where C-MOVE operations fail after exactly 512 requests.

## The Bug

**Symptoms:**
- C-MOVE operations fail after exactly 512 requests
- Failure occurs with status code **42754**
- 512 matches the default TCP backlog limit
- Strong indication of TCP connection leak

**Root Cause:**
Deno 2.4.1-2.5.2 appears to have a bug in TCP socket handling where incoming SCP connections are not properly cleaned up, eventually exhausting the TCP backlog.

## Test Design

This is a **standalone script** (not a vitest test) that can be run directly with any JavaScript runtime:

```bash
node tests/connection-leak-test.ts
deno run --allow-all --unstable-sloppy-imports --unstable-detect-cjs tests/connection-leak-test.ts
bun run tests/connection-leak-test.ts
```

The test:
1. Starts a temporary SCP server on port 9999
2. Fetches a single DICOM instance from Orthanc
3. Performs 600 C-MOVE operations on that instance
4. **Looks for status 42754** - the smoking gun of the leak
5. Reports success/failure with appropriate exit codes

## Prerequisites

### Automatic Setup (Default)

**The test automatically sets up the E2E environment!** Just run it

On first run, the test will:
1. Check if Orthanc is already running
2. If not, start `docker-compose.e2e.yml` automatically
3. Wait for Orthanc to be healthy
4. Upload test DICOM files from `tests/e2e/test-data/`
5. Run the leak test

On subsequent runs, it will detect the running environment and reuse it.

### Manual Setup (Optional)

If you prefer to start services yourself:

```bash
# Start the E2E environment manually
docker compose -f docker-compose.e2e.yml up -d orthanc

# Then run the test
node tests/connection-leak-test.ts
```

### Using Your Own Orthanc

If you have your own Orthanc instance, disable auto-setup:

```bash
AUTO_SETUP=false \
ORTHANC_HOST=192.168.1.100 \
ORTHANC_PORT=4242 \
ORTHANC_HTTP_URL=http://192.168.1.100:8042 \
node tests/connection-leak-test.ts
```

## Running the Test

### With Configuration

All configuration is via environment variables:

```bash
# Test with 1000 iterations
ITERATION_COUNT=1000 node tests/connection-leak-test.ts

# Point to different Orthanc instance
ORTHANC_HOST=192.168.1.100 \
ORTHANC_PORT=4242 \
ORTHANC_HTTP_URL=http://192.168.1.100:8042 \
node tests/connection-leak-test.ts

# Add delay between requests (useful for debugging)
DELAY_MS=100 node tests/connection-leak-test.ts

# Use different SCP port (if 9999 is in use)
SCP_PORT=10000 node tests/connection-leak-test.ts
```

### Full Configuration Reference

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `ITERATION_COUNT` | Number of times to retrieve the instance | `600` |
| `DELAY_MS` | Delay between C-MOVE requests in milliseconds | `0` |
| `AUTO_SETUP` | Automatically start Docker environment if needed | `true` |
| `ORTHANC_HOST` | Orthanc DICOM server hostname/IP | `127.0.0.1` |
| `ORTHANC_PORT` | Orthanc DICOM server port | `4242` |
| `ORTHANC_AET` | Orthanc Application Entity Title | `ORTHANC` |
| `ORTHANC_HTTP_URL` | Orthanc HTTP API URL | `http://localhost:8042` |
| `SCP_PORT` | Port for temporary test SCP server | `9999` |
| `SCP_AET` | AET for test SCP server | `LEAK_TEST_SCP` |

## Understanding the Results

### Exit Codes

- **0**: Success - no leaks detected
- **1**: General failure (network errors, etc.)
- **2**: Leak detected (status 42754 observed)

Exit code: **2**

The key indicator is **status 42754** appearing around iteration **512-513** (matching the TCP backlog limit).
