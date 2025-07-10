#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync, mkdirSync, copyFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const BUILD_DIR = './dist';
const BINARY_NAME = 'dicomweb-proxy';

function log(message) {
  console.log(`[BUILD] ${message}`);
}

function executeCommand(command, description) {
  log(description);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Failed to ${description.toLowerCase()}: ${error.message}`);
    process.exit(1);
  }
}

function main() {
  log('Starting build process...');
  
  // Clean build directory
  if (existsSync(BUILD_DIR)) {
    executeCommand(`rm -rf ${BUILD_DIR}`, 'Cleaning build directory');
  }
  mkdirSync(BUILD_DIR, { recursive: true });
  
  // Compile TypeScript
  executeCommand('npx tsc', 'Compiling TypeScript');
  
  // Copy configuration files
  if (existsSync('./config')) {
    executeCommand(`cp -r ./config ${BUILD_DIR}/`, 'Copying configuration files');
  }
  
  // Create package.json for binary
  const packageJson = {
    name: 'dicomweb-proxy',
    version: '1.0.0',
    description: 'DICOM DIMSE to DICOMweb proxy server',
    main: 'index.js',
    scripts: {
      start: 'node index.js'
    },
    dependencies: {
      'dcmjs-dimse': '^1.0.0'
    }
  };
  
  writeFileSync(
    join(BUILD_DIR, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
  
  // Install production dependencies
  executeCommand(
    `cd ${BUILD_DIR} && npm install --only=production`,
    'Installing production dependencies'
  );
  
  // Build binary with Bun (if available)
  if (commandExists('bun')) {
    log('Building binary with Bun...');
    try {
      executeCommand(
        `cd ${BUILD_DIR} && bun build --compile --minify --sourcemap --target=bun-linux-x64 --outfile=${BINARY_NAME}-linux index.js`,
        'Building Linux binary'
      );
      
      executeCommand(
        `cd ${BUILD_DIR} && bun build --compile --minify --sourcemap --target=bun-darwin-x64 --outfile=${BINARY_NAME}-macos index.js`,
        'Building macOS binary'
      );
      
      log('Binaries built successfully!');
    } catch (error) {
      log('Bun compilation failed, falling back to Node.js bundle');
      createNodeBundle();
    }
  } else {
    log('Bun not available, creating Node.js bundle');
    createNodeBundle();
  }
  
  // Create start script
  const startScript = `#!/bin/bash
# DICOM Web Proxy Start Script
# This script starts the DICOM Web Proxy server

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if binary exists
if [ -f "./${BINARY_NAME}-linux" ]; then
    echo "Starting ${BINARY_NAME} binary..."
    ./${BINARY_NAME}-linux "$@"
elif [ -f "./${BINARY_NAME}-macos" ]; then
    echo "Starting ${BINARY_NAME} binary..."
    ./${BINARY_NAME}-macos "$@"
elif [ -f "./index.js" ]; then
    echo "Starting ${BINARY_NAME} with Node.js..."
    node index.js "$@"
else
    echo "Error: No executable found"
    exit 1
fi
`;
  
  writeFileSync(join(BUILD_DIR, 'start.sh'), startScript);
  executeCommand(`chmod +x ${BUILD_DIR}/start.sh`, 'Making start script executable');
  
  // Create README for deployment
  const readmeContent = `# DICOM Web Proxy

This is a standalone DICOM Web Proxy server that translates between DICOM DIMSE and DICOMweb protocols.

## Quick Start

1. Configure the proxy by editing \`config/config.json\`
2. Run the proxy:
   - Using the start script: \`./start.sh\`
   - Using binary directly: \`./${BINARY_NAME}-linux\` or \`./${BINARY_NAME}-macos\`
   - Using Node.js: \`node index.js\`

## Configuration

The proxy looks for configuration files in the following order:
- \`./config.json\`
- \`./config/config.json\`
- \`./config/example-config.jsonc\`

## SSL Certificates

To enable HTTPS, place your SSL certificate files in the \`certs/\` directory:
- \`certs/server.crt\` - SSL certificate
- \`certs/server.key\` - Private key

Or enable \`generateSelfSigned\` in the configuration to automatically generate self-signed certificates.

## Health Check

The proxy provides health check endpoints:
- \`GET /health\` - Detailed health information
- \`GET /status\` - Server status
- \`GET /ping\` - Simple ping response

## Logs

Logs are written to the directory specified in the \`logDir\` configuration option.

## Cache

Retrieved DICOM instances are cached in the \`storagePath\` directory for improved performance.
`;
  
  writeFileSync(join(BUILD_DIR, 'README.md'), readmeContent);
  
  log('Build completed successfully!');
  log(`Build output: ${BUILD_DIR}/`);
}

function createNodeBundle() {
  // Create a simple Node.js bundle without webpack
  const bundleScript = `#!/usr/bin/env node
// Auto-generated bundle script
const path = require('path');
const fs = require('fs');

// Set up module paths
const originalModulePaths = module.paths;
module.paths.unshift(path.join(__dirname, 'node_modules'));

// Load the main application
require('./index.js');
`;
  
  writeFileSync(join(BUILD_DIR, 'bundle.js'), bundleScript);
  executeCommand(`chmod +x ${BUILD_DIR}/bundle.js`, 'Making bundle script executable');
}

function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

if (require.main === module) {
  main();
}