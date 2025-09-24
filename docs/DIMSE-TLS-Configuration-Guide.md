# DIMSE TLS Configuration Guide

## Overview

This guide explains TLS configuration options for DICOM DIMSE connections, focusing on the common scenarios when institutions connect to your proxy server.

## Connection Direction & TLS Roles

When an institution connects **TO** your proxy server:
- **Your proxy = TLS Server** (needs server certificate)
- **Institution PACS = TLS Client** (may or may not need client certificate)

Example from logs:
```
> Requesting Association|(EMRN_DC1_LTA 0.0.0.0:0) <=> (PACSBIN_PROD 10.150.195.23:8888)
```

## Common TLS Configuration Patterns

### 1. Mutual TLS (Recommended for Healthcare)

**Most common in healthcare environments** - both sides authenticate each other.

```jsonc
{
  "dimseProxySettings": {
    "proxyServer": {
      "aet": "PACSBIN_PROD",
      "ip": "0.0.0.0",
      "port": 8888,
      "securityOptions": {
        "key": "/opt/certs/dimse/server.key",     // Your private key
        "cert": "/opt/certs/dimse/server.crt",    // Your server cert (from their CA)
        "ca": "/opt/certs/dimse/ca.crt",          // Their CA to validate client certs
        "requestCert": true,                      // Request their client certificate
        "rejectUnauthorized": true,               // Reject invalid client certs
        "minVersion": "TLSv1.2",
        "maxVersion": "TLSv1.3"
      }
    }
  }
}
```

**Why it's preferred:**
- Bidirectional authentication ensures security
- Meets HIPAA/compliance requirements
- Prevents unauthorized PACS connections
- Industry standard for modern healthcare

### 2. Server-Only TLS (Legacy Support)

**Less common** - only the server (your proxy) provides a certificate.

```jsonc
{
  "dimseProxySettings": {
    "proxyServer": {
      "aet": "PACSBIN_PROD",
      "ip": "0.0.0.0",
      "port": 8888,
      "securityOptions": {
        "key": "/opt/certs/dimse/server.key",     // Your private key
        "cert": "/opt/certs/dimse/server.crt",    // Your server cert (from their CA)
        "requestCert": false,                     // Don't request client cert
        "rejectUnauthorized": false,              // Allow any client
        "minVersion": "TLSv1.2"
      }
    }
  }
}
```

**When it's used:**
- Legacy PACS systems without client certificate support
- Internal networks with other security controls
- Simplified deployment requirements

## Certificate Requirements

### What YOU Need (Server-side):
1. **Your server certificate + private key** - Identifies your proxy server
2. **Institution's CA certificate** - To validate their client certificates (mutual TLS only)

### What the INSTITUTION Should Provide:
1. **Their CA certificate** - So you can validate their client certificates
2. **Your server certificate** - Signed by their CA or a mutually trusted CA
3. **Configuration details** - TLS versions, cipher suites, etc.

### Certificate File Structure:
```
/opt/certs/dimse/
├── server.key          # Your private key (never share)
├── server.crt          # Your server certificate (from institution's CA)
└── ca.crt              # Institution's CA certificate
```

## Testing TLS Locally with dcmtk

### Generate Test Certificates:
```bash
# Create directory
mkdir -p cert-test/dicom

# Generate CA
openssl genrsa -out cert-test/dicom/ca.key 2048
openssl req -new -x509 -days 365 -key cert-test/dicom/ca.key -out cert-test/dicom/ca.crt \
  -subj "/C=US/ST=Test/L=Test/O=DICOM-Test-CA/CN=DICOM Test CA"

# Generate server certificate (for your proxy)
openssl genrsa -out cert-test/dicom/server.key 2048
openssl req -new -key cert-test/dicom/server.key -out cert-test/dicom/server.csr \
  -subj "/C=US/ST=Test/L=Test/O=DICOM-Server/CN=localhost"
openssl x509 -req -in cert-test/dicom/server.csr -CA cert-test/dicom/ca.crt -CAkey cert-test/dicom/ca.key \
  -CAcreateserial -out cert-test/dicom/server.crt -days 365

# Generate client certificate (for testing)
openssl genrsa -out cert-test/dicom/client.key 2048
openssl req -new -key cert-test/dicom/client.key -out cert-test/dicom/client.csr \
  -subj "/C=US/ST=Test/L=Test/O=DICOM-Client/CN=test-client"
openssl x509 -req -in cert-test/dicom/client.csr -CA cert-test/dicom/ca.crt -CAkey cert-test/dicom/ca.key \
  -CAcreateserial -out cert-test/dicom/client.crt -days 365

# Clean up
rm cert-test/dicom/*.csr
```

### Test with echoscu:
```bash
# Mutual TLS test
echoscu -v \
  --enable-tls \
  --private-key cert-test/dicom/client.key \
  --certificate cert-test/dicom/client.crt \
  --ca-certificate cert-test/dicom/ca.crt \
  --verify-peer \
  DICOMWEB_PROXY 127.0.0.1 8888

# Server-only TLS test
echoscu --enable-tls --ignore-peer-cert DICOMWEB_PROXY 127.0.0.1 8888
```

## Determining Institution Requirements

**Ask the institution:**
1. "Do you use mutual TLS for DICOM connections, or server-only TLS?"
2. "Do your PACS systems present client certificates when connecting?"
3. "Should we validate client certificates, or just provide server authentication?"
4. "What TLS versions and cipher suites do you require?"
5. "Can you provide your CA certificate for client validation?"

**Testing approach:**
1. Start with server-only TLS (`requestCert: false`)
2. If they require client cert validation, switch to mutual TLS
3. Monitor logs for "(TLS)" and "(Authorized)" indicators

## Expected Log Output

**Successful TLS connection:**
```
DIMSE SCP Server: TLS options configured successfully
Client connecting from 10.150.195.23:xxxxx (TLS) (Authorized)
DIMSE SCP: Association request from EMRN_DC1_LTA to PACSBIN_PROD
DIMSE SCP: C-ECHO request received - responding with Success
```

**This replaces the previous "Unknown PDU type" errors** which occurred when encrypted TLS data was incorrectly parsed as plain DICOM PDUs.

## Security Best Practices

1. **Use mutual TLS when possible** for maximum security
2. **Keep certificates separate** from HTTPS certificates (different ports, different trust chains)
3. **Use strong TLS versions** (TLSv1.2 minimum, TLSv1.3 preferred)
4. **Validate client certificates** in production environments
5. **Monitor certificate expiration dates**
6. **Use absolute paths** for all certificate files in configuration

## Troubleshooting

- **"Unknown PDU type" errors** = Institution sending TLS but proxy expecting plain DICOM
- **Certificate validation failures** = Check CA certificate configuration
- **Connection refused** = Check port accessibility and firewall rules
- **Handshake failures** = Verify TLS version compatibility and cipher suites