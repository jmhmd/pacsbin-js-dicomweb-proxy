#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync, mkdirSync, readFileSync } = require('fs');
const { join } = require('path');

const BASE_BUILD_DIR = './build';
const BINARY_NAME = 'dicomweb-proxy';

// Parse command line arguments
const args = process.argv.slice(2);
const isRhelBuild = args.includes('--rhel') || args.includes('--linux');
const forceDeno = args.includes('--deno');
const forceBun = args.includes('--bun');
const forceNode = args.includes('--node');
const platform = isRhelBuild ? 'rhel' : 'local';
const targetSuffix = isRhelBuild ? '-linux' : '';

// Platform-specific build directory
const BUILD_DIR = `${BASE_BUILD_DIR}/${platform}`;
const binaryName = `${BINARY_NAME}${targetSuffix}`;

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

function commandExists(command) {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

function tryBunBuild() {
  if (!commandExists('bun')) {
    log('Bun not available');
    return false;
  }

  const targetFlag = isRhelBuild ? '--target=bun-linux-x64-baseline' : '';
  const outputFile = `${BUILD_DIR}/${binaryName}`;
  
  log(`Attempting to build with Bun${isRhelBuild ? ` (${platform} target)` : ''}...`);
  try {
    executeCommand(
      `bun build ./src/index.ts --compile --minify ${targetFlag} --outfile ${outputFile}`,
      `Building with Bun${isRhelBuild ? ` for ${platform}` : ''}`
    );
    return true;
  } catch (error) {
    log('Bun build failed');
    return false;
  }
}

function tryDenoBuild() {
  if (!commandExists('deno')) {
    log('Deno not available');
    return false;
  }

  const targetFlag = isRhelBuild ? '--target=x86_64-unknown-linux-gnu' : '';
  const outputFile = `${BUILD_DIR}/${binaryName}`;
  
  log(`Attempting to build with Deno${isRhelBuild ? ` (${platform} target)` : ''}...`);
  try {
    // Use Deno compile with full Node.js compatibility flags
    // --unstable-sloppy-imports allows regular Node.js import syntax
    // --node-modules-dir enables npm package resolution
    executeCommand(
      `deno compile --allow-all --unstable-sloppy-imports --unstable-node-globals --node-modules-dir ${targetFlag} --output ${outputFile} ./src/index.ts`,
      `Building with Deno${isRhelBuild ? ` for ${platform}` : ''}`
    );
    
    return true;
  } catch (error) {
    log('Deno build failed');
    return false;
  }
}

function buildWithNode() {
  log(`Building with Node.js and TypeScript${isRhelBuild ? ` (${platform} target)` : ''}...`);
  
  // Compile TypeScript to build directory
  executeCommand(`npx tsc --outDir ${BUILD_DIR}`, 'Compiling TypeScript');
  
  // Copy package.json and install only production dependencies
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  
  // Create a production package.json (keep only runtime dependencies)
  const prodPackageJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    main: 'index.js',
    bin: {
      [BINARY_NAME]: 'index.js'
    },
    dependencies: packageJson.dependencies,
    engines: packageJson.engines
  };
  
  require('fs').writeFileSync(
    join(BUILD_DIR, 'package.json'),
    JSON.stringify(prodPackageJson, null, 2)
  );
  
  // Install only production dependencies in build directory
  executeCommand(
    `cd ${BUILD_DIR} && npm install --omit=dev --omit=optional`,
    'Installing production dependencies'
  );
  
  log(`Node.js build completed${isRhelBuild ? ` (${platform} compatible)` : ''}`);
  return true;
}

function copyDeploymentFiles() {
  log('Copying deployment files...');
  
  // Copy example configuration file and rename to config.jsonc
  if (existsSync('./config/example-config.jsonc')) {
    executeCommand(`mkdir -p ${BUILD_DIR}/config`, 'Creating config directory');
    executeCommand(`cp ./config/example-config.jsonc ${BUILD_DIR}/config/config.jsonc`, 'Copying configuration file as config.jsonc');
  }
  
  // Copy platform-specific deployment files
  if (isRhelBuild) {
    // Copy RHEL-specific files
    if (existsSync('./rhel')) {
      executeCommand(`cp -r ./rhel/* ${BUILD_DIR}/`, 'Copying RHEL deployment files');
    }
    
    // Create installation instructions
    createInstallationReadme();
  }
  
  // Copy common documentation
  if (existsSync('./README.md')) {
    executeCommand(`cp ./README.md ${BUILD_DIR}/`, 'Copying README');
  }
  
  if (existsSync('./LICENSE')) {
    executeCommand(`cp ./LICENSE ${BUILD_DIR}/`, 'Copying LICENSE');
  }
}

function createInstallationReadme() {
  const readmeContent = `# DICOM Web Proxy - ${platform.toUpperCase()} Deployment Package

This package contains everything needed to deploy the DICOM Web Proxy on ${platform.toUpperCase()} systems.

## Contents

- \`${binaryName}\` - The compiled DICOM Web Proxy binary (includes built-in installer)
- \`setup-rhel.sh\` - Legacy Bash installation script (deprecated)
- \`dicomweb-proxy.service\` - Systemd service configuration
- \`config/config.jsonc\` - Configuration file
- \`README.md\` - Deployment documentation

## Quick Installation (Recommended)

The binary now includes a built-in TypeScript installer. This is the preferred method:

1. Transfer this entire directory to your ${platform.toUpperCase()} server
2. Make the binary executable and run the installer:
   \`\`\`bash
   chmod +x ${binaryName}
   sudo ./${binaryName} install-rhel
   \`\`\`

## Installation Options

### Standard Installation (Service User)
\`\`\`bash
sudo ./${binaryName} install-rhel
\`\`\`
- Creates \`dicomweb\` service user
- Runs with minimal privileges
- Automatically falls back to root if user creation fails

### Root Installation (Maximum Compatibility)
\`\`\`bash
sudo ./${binaryName} install-rhel --root
\`\`\`
- Service runs as root
- Maximum compatibility with system resources
- Use if standard installation has permission issues

### Convert Existing Service to Root
\`\`\`bash
sudo ./${binaryName} install-rhel --convert-to-root
\`\`\`
- Converts existing service user installation to run as root
- Useful for troubleshooting permission issues

### Test Installation
\`\`\`bash
sudo ./${binaryName} test-install
\`\`\`
- Validates current installation
- Checks binary permissions, config validity, service files

### Uninstall
\`\`\`bash
sudo ./${binaryName} uninstall-rhel
\`\`\`
- Removes service and systemd configuration
- Preserves application files (manual removal required)

## Installation Features

The built-in installer provides:
- **Configuration validation** - Fails fast on invalid config with detailed error messages
- **Automatic dependencies** - Installs required system packages (firewalld, libcap, etc.)
- **Smart user management** - Creates service user with automatic root fallback
- **SSL certificate handling** - Validates and installs certificates if SSL is enabled
- **Firewall configuration** - Opens required ports in firewalld
- **SELinux compatibility** - Configures SELinux contexts when needed
- **Service management** - Creates and enables systemd service
- **Binary capabilities** - Sets \`cap_net_bind_service\` for privileged port binding

## Legacy Installation (Deprecated)

The Bash script is still included but deprecated:
\`\`\`bash
chmod +x setup-rhel.sh
sudo ./setup-rhel.sh
\`\`\`

## Configuration

Edit \`/opt/dicomweb-proxy/config/config.jsonc\` after installation to configure:
- DIMSE peers (PACS servers)
- Network ports
- SSL certificates  
- Cache settings

**Important**: The installer validates configuration before making system changes. Fix any validation errors and re-run the installer.

## Service Management

\`\`\`bash
# Start the service
sudo systemctl start dicomweb-proxy

# Check status
sudo systemctl status dicomweb-proxy

# View logs
sudo journalctl -u dicomweb-proxy -f

# Restart service
sudo systemctl restart dicomweb-proxy
\`\`\`

## Proxy Usage

Once installed, the binary also serves as the proxy server:
\`\`\`bash
# View help
./${binaryName} --help

# Start proxy directly (for testing)
./${binaryName} config.jsonc
\`\`\`

## Troubleshooting

### Installation Issues
- **Config validation fails**: Fix errors in \`config.jsonc\` and retry
- **Permission denied**: Ensure running with \`sudo\`
- **Service won't start**: Try \`--root\` installation for maximum compatibility
- **Port binding fails**: Check if \`cap_net_bind_service\` capability is set

### Service Issues
- **View detailed logs**: \`sudo journalctl -u dicomweb-proxy -n 50\`
- **Check configuration**: \`sudo cat /opt/dicomweb-proxy/config/config.jsonc\`
- **Verify permissions**: \`sudo ls -la /opt/dicomweb-proxy/\`
- **Test configuration**: \`sudo ./${binaryName} test-install\`

### Converting to Root Mode
If the service has permission issues, convert to root mode:
\`\`\`bash
sudo ./${binaryName} install-rhel --convert-to-root
\`\`\`

## Version Information

- Built: ${new Date().toISOString()}
- Platform: ${platform}
- Binary: ${binaryName}
- Installer: Built-in TypeScript installer

For more information, see the full documentation in README.md
`;

  require('fs').writeFileSync(join(BUILD_DIR, 'INSTALL.md'), readmeContent);
  log('Created installation instructions');
}

function createDeploymentManifest() {
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  const manifest = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    platform: platform,
    architecture: isRhelBuild ? 'x86_64' : 'native',
    binaryName: binaryName,
    buildDate: new Date().toISOString(),
    buildMethod: 'unknown', // Will be set during build
    files: {
      binary: binaryName,
      config: 'config/config.jsonc',
      service: isRhelBuild ? 'dicomweb-proxy.service' : null,
      installer: isRhelBuild ? `${binaryName} (built-in installer)` : null,
      legacyInstaller: isRhelBuild ? 'setup-rhel.sh (deprecated)' : null,
      documentation: ['README.md', 'INSTALL.md']
    },
    requirements: {
      os: isRhelBuild ? 'Red Hat Enterprise Linux 8+' : 'Local development',
      architecture: 'x86_64',
      minimumMemory: '512MB',
      recommendedMemory: '2GB'
    }
  };

  require('fs').writeFileSync(
    join(BUILD_DIR, 'deployment-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  log('Created deployment manifest');
}

function createDeploymentArchive() {
  if (!isRhelBuild) return; // Only create archives for specific platforms
  
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  const archiveName = `${packageJson.name}-${packageJson.version}-${platform}-x86_64.tar.gz`;
  const archivePath = `${BASE_BUILD_DIR}/${archiveName}`;
  
  try {
    executeCommand(
      `cd ${BASE_BUILD_DIR} && tar -czf ${archiveName} ${platform}/`,
      'Creating deployment archive'
    );
    log(`Created deployment archive: ${archivePath}`);
    log('Archive ready for distribution!');
  } catch (error) {
    log('Note: Could not create tar archive (tar command not available)');
    log('You can manually zip the build directory for distribution');
  }
}

function main() {
  // Check for help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
DICOM Web Proxy Build Script

Usage: node build.js [options]

Options:
  --deno          Force build with Deno (also the default)
  --bun           Force build with Bun
  --node          Force build with Node.js + TypeScript
  --rhel, --linux Build for RHEL/Linux deployment
  --help, -h      Show this help message

Build order when no runtime is specified:
  1. Deno (default)
  2. Bun (fallback)
  3. Node.js (fallback)

Examples:
  node build.js                  # Build with Deno (default)
  node build.js --bun            # Force build with Bun
  node build.js --node --rhel    # Build with Node.js for RHEL
`);
    process.exit(0);
  }

  log(`Starting build process for ${platform}...`);
  
  // Clean and create build directory
  if (existsSync(BUILD_DIR)) {
    executeCommand(`rm -rf ${BUILD_DIR}`, 'Cleaning build directory');
  }
  mkdirSync(BUILD_DIR, { recursive: true });
  
  // Try build methods in order of preference
  let buildSuccess = false;
  let buildMethod = 'unknown';
  
  if (forceBun) {
    // Force Bun build when --bun flag is used
    if (tryBunBuild()) {
      buildSuccess = true;
      buildMethod = 'bun';
      log('Successfully built with Bun (forced)');
    } else {
      console.error('Forced Bun build failed');
      process.exit(1);
    }
  } else if (forceNode) {
    // Force Node build when --node flag is used
    if (buildWithNode()) {
      buildSuccess = true;
      buildMethod = 'node';
      log('Successfully built with Node.js (forced)');
    } else {
      console.error('Forced Node build failed');
      process.exit(1);
    }
  } else if (forceDeno) {
    // Force Deno build when --deno flag is used
    if (tryDenoBuild()) {
      buildSuccess = true;
      buildMethod = 'deno';
      log('Successfully built with Deno (forced)');
    } else {
      console.error('Forced Deno build failed');
      process.exit(1);
    }
  } else if (tryDenoBuild()) {
    // Default to Deno build
    buildSuccess = true;
    buildMethod = 'deno';
    log('Successfully built with Deno (default)');
  } else if (tryBunBuild()) {
    buildSuccess = true;
    buildMethod = 'bun';
    log('Successfully built with Bun (fallback)');
  } else if (buildWithNode()) {
    buildSuccess = true;
    buildMethod = 'node';
    log('Successfully built with Node.js (fallback)');
  }
  
  if (!buildSuccess) {
    console.error('All build methods failed');
    process.exit(1);
  }
  
  // Copy deployment files and create package
  copyDeploymentFiles();
  
  // Update manifest with build method
  createDeploymentManifest();
  const manifestPath = join(BUILD_DIR, 'deployment-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.buildMethod = buildMethod;
  require('fs').writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Create deployment archive
  createDeploymentArchive();
  
  log('Build completed successfully!');
  log(`Platform: ${platform}`);
  log(`Build method: ${buildMethod}${forceDeno ? ' (forced)' : ''}`);
  log(`Build output: ${BUILD_DIR}/`);
  log(`Package contents:`);
  log(`  Binary: ${binaryName}`);
  log(`  Config: config/config.jsonc`);
  if (isRhelBuild) {
    log(`  Installer: setup-rhel.sh`);
    log(`  Service: dicomweb-proxy.service`);
    log(`  Docs: README.md, INSTALL.md`);
    log('');
    log('Ready for deployment! You can now:');
    log(`  1. Zip the entire ${BUILD_DIR}/ directory`);
    log(`  2. Transfer to target ${platform.toUpperCase()} server`);
    log(`  3. Run: sudo ./setup-rhel.sh`);
  } else {
    log(`  Docs: README.md`);
    log('');
    log('To run locally:');
    log(`  cd ${BUILD_DIR} && ./${binaryName} config/config.jsonc`);
  }
  
  if (forceDeno || forceBun || forceNode) {
    log('');
    log(`Note: Built with ${buildMethod} runtime (--${buildMethod} flag used)`);
  }
}

// Only run main if this file is executed directly
if (require.main === module) {
  main();
}