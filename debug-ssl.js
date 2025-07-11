#!/usr/bin/env node

// SSL Debugging Script for DICOM Web Proxy
// Run this to diagnose SSL certificate issues

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

function checkCertificateFiles(certPath, keyPath) {
  log('INFO', 'Checking certificate files...');
  
  // Check if files exist
  if (!fs.existsSync(certPath)) {
    log('ERROR', `Certificate file not found: ${certPath}`);
    return false;
  }
  
  if (!fs.existsSync(keyPath)) {
    log('ERROR', `Private key file not found: ${keyPath}`);
    return false;
  }
  
  log('INFO', `Certificate file found: ${certPath}`);
  log('INFO', `Private key file found: ${keyPath}`);
  
  // Check file permissions
  try {
    const certStats = fs.statSync(certPath);
    const keyStats = fs.statSync(keyPath);
    
    log('INFO', `Certificate permissions: ${(certStats.mode & parseInt('777', 8)).toString(8)}`);
    log('INFO', `Private key permissions: ${(keyStats.mode & parseInt('777', 8)).toString(8)}`);
  } catch (error) {
    log('ERROR', `Failed to check file permissions: ${error.message}`);
  }
  
  return true;
}

function validateCertificateContent(certPath, keyPath) {
  log('INFO', 'Validating certificate content...');
  
  try {
    const cert = fs.readFileSync(certPath, 'utf8');
    const key = fs.readFileSync(keyPath, 'utf8');
    
    // Check certificate format
    if (!cert.includes('-----BEGIN CERTIFICATE-----')) {
      log('ERROR', 'Certificate file does not contain valid PEM certificate');
      return false;
    }
    
    // Check private key format
    if (!key.includes('-----BEGIN PRIVATE KEY-----') && 
        !key.includes('-----BEGIN RSA PRIVATE KEY-----') &&
        !key.includes('-----BEGIN EC PRIVATE KEY-----')) {
      log('ERROR', 'Private key file does not contain valid PEM private key');
      return false;
    }
    
    log('INFO', 'Certificate and private key have valid PEM format');
    
    // Try to parse the certificate
    try {
      const x509 = crypto.createPublicKey(cert);
      log('INFO', 'Certificate parsed successfully');
    } catch (error) {
      log('ERROR', `Failed to parse certificate: ${error.message}`);
      return false;
    }
    
    // Try to parse the private key
    try {
      const privateKey = crypto.createPrivateKey(key);
      log('INFO', 'Private key parsed successfully');
    } catch (error) {
      log('ERROR', `Failed to parse private key: ${error.message}`);
      return false;
    }
    
    return true;
  } catch (error) {
    log('ERROR', `Failed to read certificate files: ${error.message}`);
    return false;
  }
}

function testSslOptions(certPath, keyPath, port = 8443) {
  log('INFO', `Testing SSL server on port ${port}...`);
  
  try {
    const cert = fs.readFileSync(certPath, 'utf8');
    const key = fs.readFileSync(keyPath, 'utf8');
    
    const sslOptions = {
      key: key,
      cert: cert,
      // Add additional options that might help with mkcert certificates
      secureProtocol: 'TLSv1_2_method',
      honorCipherOrder: true,
      ciphers: [
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-SHA256',
        'ECDHE-RSA-AES256-SHA384',
        'ECDHE-RSA-AES128-SHA',
        'ECDHE-RSA-AES256-SHA',
        'AES128-GCM-SHA256',
        'AES256-GCM-SHA384',
        'AES128-SHA256',
        'AES256-SHA256',
        'AES128-SHA',
        'AES256-SHA'
      ].join(':')
    };
    
    const server = https.createServer(sslOptions, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('SSL test successful!');
    });
    
    server.listen(port, () => {
      log('INFO', `SSL test server started on https://localhost:${port}`);
      log('INFO', 'Try accessing https://localhost:' + port + ' in your browser');
      log('INFO', 'Press Ctrl+C to stop the test server');
    });
    
    server.on('error', (error) => {
      log('ERROR', `SSL server error: ${error.message}`);
      if (error.code === 'EADDRINUSE') {
        log('INFO', `Port ${port} is already in use. Try a different port.`);
      }
    });
    
    server.on('clientError', (error) => {
      log('ERROR', `SSL client error: ${error.message}`);
    });
    
    server.on('secureConnection', (tlsSocket) => {
      log('INFO', 'Secure connection established');
      log('INFO', `Protocol: ${tlsSocket.getProtocol()}`);
      log('INFO', `Cipher: ${tlsSocket.getCipher()?.name}`);
    });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      log('INFO', 'Shutting down SSL test server...');
      server.close(() => {
        log('INFO', 'SSL test server stopped');
        process.exit(0);
      });
    });
    
  } catch (error) {
    log('ERROR', `Failed to start SSL test server: ${error.message}`);
  }
}

function showMkcertHelp() {
  log('INFO', 'mkcert troubleshooting tips:');
  console.log(`
1. Ensure mkcert CA is installed:
   mkcert -install

2. Generate certificate for localhost:
   mkcert localhost 127.0.0.1 ::1

3. This should create:
   - localhost+2.pem (certificate)
   - localhost+2-key.pem (private key)

4. Update your configuration to use absolute paths:
   {
     "ssl": {
       "enabled": true,
       "port": 443,
       "certPath": "/absolute/path/to/localhost+2.pem",
       "keyPath": "/absolute/path/to/localhost+2-key.pem"
     }
   }

5. Common issues:
   - Relative paths not resolving correctly
   - File permissions (cert files should be readable by the service user)
   - Wrong certificate format (must be PEM format)
   - Certificate not trusted by system (run 'mkcert -install')
`);
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help') {
    console.log(`
SSL Debug Tool for DICOM Web Proxy

Usage:
  node debug-ssl.js <cert-path> <key-path> [port]
  node debug-ssl.js --mkcert-help

Examples:
  node debug-ssl.js ./localhost+2.pem ./localhost+2-key.pem
  node debug-ssl.js /opt/dicomweb-proxy/certs/cert.pem /opt/dicomweb-proxy/certs/key.pem 8443
`);
    return;
  }
  
  if (args[0] === '--mkcert-help') {
    showMkcertHelp();
    return;
  }
  
  if (args.length < 2) {
    log('ERROR', 'Certificate path and private key path are required');
    return;
  }
  
  const certPath = path.resolve(args[0]);
  const keyPath = path.resolve(args[1]);
  const port = args[2] ? parseInt(args[2]) : 8443;
  
  log('INFO', 'Starting SSL diagnostics...');
  log('INFO', `Certificate: ${certPath}`);
  log('INFO', `Private Key: ${keyPath}`);
  
  if (!checkCertificateFiles(certPath, keyPath)) {
    log('ERROR', 'Certificate file check failed');
    return;
  }
  
  if (!validateCertificateContent(certPath, keyPath)) {
    log('ERROR', 'Certificate content validation failed');
    return;
  }
  
  log('INFO', 'Certificate validation passed. Starting SSL test server...');
  testSslOptions(certPath, keyPath, port);
}

main();