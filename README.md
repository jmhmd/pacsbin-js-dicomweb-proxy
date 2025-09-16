# DICOM Web Proxy

Lightweight JS/TS-only DICOM proxy server that translates between DICOM DIMSE and DICOMweb protocols. Prioritizes ease of deployment and minimal external dependencies.

## Features

- **Dual Proxy Modes**:
  - DIMSE to DICOMweb translation for connecting to DIMSE-only systems
  - DICOMweb passthrough for forwarding to modern DICOMweb servers with addition
    of necessary CORS headers
- **QIDO & WADO Support**: Support for study, series, and instance queries and
  retrieval, although the Pacsbin uploader only _needs_ instance level WADO p10 retrieve and QIDO
- **Local Caching**: Configurable file-based cache for improved performance -
  disabled by default to avoid complexity
- **SSL/TLS Support**: Built-in HTTPS support with custom or self-signed certificates
- **CORS Configuration**: CORS policy configuration
- **Single Binary Deployment**: Compile to standalone executable for easy deployment
- **Simple installation**: Installer built in to executable

## Quick Start

1. **Configure the proxy** by editing `config/config.jsonc`
2. **Install dependencies**: `npm install`
3. **Build the project**: `npm run build`
4. **Run the proxy**: `npm start`

## Configuration

The proxy looks for configuration files in the following order:

- `./config.json`
- `./config.jsonc`
- `./config/config.json`
- `./config/config.jsonc`

### Configuration Options

```jsonc
{
  "proxyMode": "dimse", // "dimse" or "dicomweb"

  // DIMSE proxy settings (when proxyMode is "dimse")
  "dimseProxySettings": {
    "proxyServer": {
      "aet": "PACSBIN_PROXY",
      "ip": "0.0.0.0",
      "port": 8888
    },
    "peers": [
      {
        "aet": "PACS_SERVER",
        "ip": "127.0.0.1",
        "port": 11112
      }
    ]
  },

  // DICOMweb proxy settings (when proxyMode is "dicomweb"). This is used to transparently proxy
  // dicomweb requests to another dicomweb endpoint, while adding the needed CORS headers to responses,
  // as it seems that this is not configurable in some (most?) commercial archives.
  "dicomwebProxySettings": {
    "qidoForwardingUrl": "https://qidor.example.com/qidor",
    "wadoForwardingUrl": "https://wado.example.com/wado"
  },

  "webserverPort": 3006,
  "storagePath": "./data",
  "cacheRetentionMinutes": 60,
  "useCget": false,
  "useFetchLevel": "SERIES",
  "maxAssociations": 4,

  // SSL configuration
  "ssl": {
    "enabled": false,
    "port": 443,
    // Cert paths must be absolute
    "certPath": "/certs/server.crt",
    "keyPath": "/certs/server.key",
    "generateSelfSigned": false,
    "redirectHttp": true
  },

  // CORS configuration
  "cors": {
    "origin": ["*"],
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allowedHeaders": ["Content-Type", "Authorization", "Accept"],
    "credentials": true
  }
}
```

## API Endpoints

### QIDO (Query)

- `GET /studies` - Query studies
- `GET /studies/{studyInstanceUID}/series` - Query series
- `GET /studies/{studyInstanceUID}/series/{seriesInstanceUID}/instances` - Query instances

### WADO (Retrieve)

- `GET /studies/{studyInstanceUID}` - Retrieve study
- `GET /studies/{studyInstanceUID}/series/{seriesInstanceUID}` - Retrieve series
- `GET /studies/{studyInstanceUID}/series/{seriesInstanceUID}/instances/{sopInstanceUID}` - Retrieve instance

### Health Check

- `GET /health` - Detailed health information
- `GET /status` - Server status
- `GET /ping` - Simple ping response

## Building for Production

### Build TypeScript

```bash
npm run compile
```

This compiles typescript to JS, in the `dist/` dir.

### Build Standalone Binary

```bash
npm run build
```

This creates a `build/` directory with:

- Compiled JavaScript files
- Standalone binaries (if Bun/Deno is available)
- Configuration files
- Start script
- Documentation

### Deployment Options

1. **Standalone Binary**: Use the compiled binary from `build/`
2. **Node.js**: Run `node dist/index.js`

## SSL/TLS Configuration

### Using Custom Certificates

Place your SSL certificate files in the directory configured in the config file,
such as:

- `certs/server.crt` - SSL certificate
- `certs/server.key` - Private key

### Self-Signed Certificates

Enable `generateSelfSigned` in the configuration to automatically generate self-signed certificates.

## Cache Management

The proxy includes a built-in file-based cache system:

- Cached files are stored in the `storagePath` directory
- Configurable retention time and maximum size
- Automatic cleanup of expired entries
- LRU eviction when size limits are reached

## Development

### Project Structure

```
src/
├── server/          # HTTP server and middleware
├── dimse/           # DIMSE client and translation
├── cache/           # File-based caching system
├── handlers/        # Request handlers (QIDO, WADO)
├── config/          # Configuration management
├── types/           # TypeScript type definitions
└── index.ts         # Main application entry point
```

### Scripts

- `npm run dev` - Development mode with TypeScript compilation
- `npm run build` - Production build with binary compilation
- `npm run compile` - TypeScript compilation only
- `npm run clean` - Clean build artifacts

