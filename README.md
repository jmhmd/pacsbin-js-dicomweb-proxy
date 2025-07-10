# DICOM Web Proxy

A lean, hospital-network-ready DICOM proxy server that translates between DICOM DIMSE and DICOMweb protocols. Built with TypeScript and designed for ease of deployment with minimal external dependencies.

## Features

- **Dual Proxy Modes**: 
  - DIMSE to DICOMweb translation for connecting to legacy PACS systems
  - DICOMweb passthrough for forwarding to modern DICOMweb servers
- **QIDO & WADO Support**: Full support for study, series, and instance queries and retrieval
- **Local Caching**: Configurable file-based cache for improved performance
- **SSL/TLS Support**: Built-in HTTPS support with custom or self-signed certificates
- **CORS Configuration**: Flexible CORS policy configuration
- **Single Binary Deployment**: Compile to standalone executable for easy deployment
- **Hospital Network Ready**: Designed for closed networks with minimal dependencies

## Quick Start

1. **Configure the proxy** by editing `config/example-config.jsonc`
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
  
  // DICOMweb proxy settings (when proxyMode is "dicomweb")
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
    "certPath": "./certs/server.crt",
    "keyPath": "./certs/server.key",
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

### Build Standalone Binary
```bash
npm run build
```

This creates a `dist/` directory with:
- Compiled JavaScript files
- Standalone binaries (if Bun is available)
- Configuration files
- Start script
- Documentation

### Deployment Options

1. **Standalone Binary**: Use the compiled binary from `dist/`
2. **Node.js**: Run `node dist/index.js`
3. **Start Script**: Use `./start.sh` which automatically detects the best option

## SSL/TLS Configuration

### Using Custom Certificates
Place your SSL certificate files in the `certs/` directory:
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

## License

MIT License

## Contributing

This project is designed for hospital network deployment with a focus on security, reliability, and ease of use. Please ensure all contributions maintain these principles.