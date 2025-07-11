#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync, mkdirSync, readFileSync } = require('fs');
const { join } = require('path');

const BUILD_DIR = './build';
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

  log('Attempting to build with Bun...');
  try {
    executeCommand(
      `bun build ./src/index.ts --compile --minify --outfile ${BUILD_DIR}/${BINARY_NAME}`,
      'Building with Bun'
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

  log('Attempting to build with Deno...');
  try {
    executeCommand(
      `deno compile --allow-all --output ${BUILD_DIR}/${BINARY_NAME} ./src/index.ts`,
      'Building with Deno'
    );
    return true;
  } catch (error) {
    log('Deno build failed');
    return false;
  }
}

function buildWithNode() {
  log('Building with Node.js and TypeScript...');
  
  // Compile TypeScript to build directory
  executeCommand('npx tsc --outDir ./build', 'Compiling TypeScript');
  
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
  
  log('Node.js build completed');
  return true;
}

function main() {
  log('Starting build process...');
  
  // Clean and create build directory
  if (existsSync(BUILD_DIR)) {
    executeCommand(`rm -rf ${BUILD_DIR}`, 'Cleaning build directory');
  }
  mkdirSync(BUILD_DIR, { recursive: true });
  
  // Copy configuration files
  if (existsSync('./config')) {
    executeCommand(`cp -r ./config ${BUILD_DIR}/`, 'Copying configuration files');
  }
  
  // Try build methods in order of preference
  let buildSuccess = false;
  
  if (tryBunBuild()) {
    buildSuccess = true;
    log('Successfully built with Bun');
  } else if (tryDenoBuild()) {
    buildSuccess = true;
    log('Successfully built with Deno');
  } else if (buildWithNode()) {
    buildSuccess = true;
    log('Successfully built with Node.js');
  }
  
  if (!buildSuccess) {
    console.error('All build methods failed');
    process.exit(1);
  }
  
  log('Build completed successfully!');
  log(`Build output: ${BUILD_DIR}/`);
  log('To run: cd build && node index.js [config-file]');
}

if (require.main === module) {
  main();
}