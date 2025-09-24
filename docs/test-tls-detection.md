# Testing TLS Mismatch Detection

This document explains how to test the improved TLS mismatch detection.

## Testing Scenarios

### 1. TLS Client → Non-TLS Server (Most Common Error)

**Setup**: Start proxy with TLS disabled (default config)
```bash
npm run dev
```

**Test**: Connect with TLS client
```bash
# This will now show clear TLS mismatch error instead of cryptic "Unknown PDU type: 22"
echoscu -v -aec DICOM_WEB_PROXY -aet TEST_CLIENT \
  --enable-tls cert-test/dicom/client.key cert-test/dicom/client.crt \
  --add-cert-file cert-test/dicom/ca.crt localhost 8888
```

**Expected Output**:
```
🔒 TLS MISMATCH DETECTED: Client is attempting TLS connection (PDU type 22/HANDSHAKE) but server TLS is disabled. Enable TLS on server or disable TLS on client. If using dcmtk tools, remove --enable-tls flag. If server should use TLS, add securityOptions to config.
📋 Connection details: {
  clientData: 'First 10 bytes: 0x16 0x03 0x01 0x02 0x00 0x01 0x00 0x01 0xfc 0x03',
  serverTlsEnabled: false,
  detectedProtocol: 'TLS/SSL',
  expectedProtocol: 'DICOM'
}
DIMSE SCP: Closing connection due to TLS mismatch
```

### 2. Non-TLS Client → TLS Server

**Setup**: Start proxy with TLS enabled
```bash
# Use TLS configuration
cp config/example-tls-config.jsonc config/config.jsonc
npm run dev
```

**Test**: Connect without TLS
```bash
# This will show connection refused or timeout - TLS server expects TLS handshake
echoscu -v -aec DICOM_WEB_PROXY -aet TEST_CLIENT localhost 8889
```

### 3. Correct TLS Client → TLS Server

**Setup**: Start proxy with TLS enabled (as above)

**Test**: Connect with matching TLS client
```bash
echoscu -v -aec DICOM_WEB_PROXY -aet TEST_CLIENT \
  --enable-tls cert-test/dicom/client.key cert-test/dicom/client.crt \
  --add-cert-file cert-test/dicom/ca.crt localhost 8889
```

**Expected**: Successful C-ECHO

## Improved Logging

The server now provides clear TLS configuration information on startup:

### TLS Enabled:
```
🔒 DIMSE TLS Configuration:
   Certificate: /path/to/server.crt
   Private Key: /path/to/server.key
   CA Certificate: /path/to/ca.crt
   Request Client Certs: true
   Reject Unauthorized: false
   TLS Version: TLS 1.2+ to TLS 1.3
   Client connections MUST use TLS (e.g., echoscu --enable-tls ...)
```

### TLS Disabled:
```
🔓 DIMSE TLS is DISABLED
   Client connections must NOT use TLS (e.g., echoscu without --enable-tls)
```

## Error Detection Features

1. **Early Detection**: TLS handshake detected on first data packet
2. **Protocol Analysis**: Identifies TLS record types (Alert: 21, Handshake: 22, etc.)
3. **Version Detection**: Validates TLS version numbers
4. **Clear Messaging**: Explains the mismatch and provides solutions
5. **Graceful Closure**: Closes connection cleanly instead of throwing cryptic errors
6. **Retroactive Analysis**: Analyzes existing "Unknown PDU" errors for TLS patterns

## Implementation Details

- `isTlsHandshake()`: Detects TLS record format in incoming data
- `getTlsMismatchError()`: Generates helpful error messages
- Socket data handler: Intercepts first data packet for analysis
- Error handler: Provides additional context for PDU-related errors