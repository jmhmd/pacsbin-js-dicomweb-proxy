#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync, mkdirSync, readFileSync } = require('fs');
const { join } = require('path');

const BUILD_DIR = './build';
const BINARY_NAME = 'dicomweb-proxy';

// Parse command line arguments
const args = process.argv.slice(2);
const isRhelBuild = args.includes('--rhel') || args.includes('--linux');
const targetSuffix = isRhelBuild ? '-linux' : '';

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
  const outputFile = `${BUILD_DIR}/${BINARY_NAME}${targetSuffix}`;
  
  log(`Attempting to build with Bun${isRhelBuild ? ' (RHEL target)' : ''}...`);
  try {
    executeCommand(
      `bun build ./src/index.ts --compile --minify ${targetFlag} --outfile ${outputFile}`,
      `Building with Bun${isRhelBuild ? ' for RHEL' : ''}`
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
  const outputFile = `${BUILD_DIR}/${BINARY_NAME}${targetSuffix}`;
  
  log(`Attempting to build with Deno${isRhelBuild ? ' (RHEL target)' : ''}...`);
  try {
    executeCommand(
      `deno compile --allow-all ${targetFlag} --output ${outputFile} ./src/index.ts`,
      `Building with Deno${isRhelBuild ? ' for RHEL' : ''}`
    );
    return true;
  } catch (error) {
    log('Deno build failed');
    return false;
  }
}

function buildWithNode() {
  log(`Building with Node.js and TypeScript${isRhelBuild ? ' (RHEL target)' : ''}...`);
  
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
  
  log(`Node.js build completed${isRhelBuild ? ' (RHEL compatible)' : ''}`);
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
  if (isRhelBuild) {
    log('RHEL binary created. Transfer to RHEL system and run:');
    log(`  chmod +x ${BINARY_NAME}${targetSuffix}`);
    log(`  ./${BINARY_NAME}${targetSuffix} [config-file]`);
  } else {
    log('To run: cd build && node index.js [config-file]');
  }
}

if (require.main === module) {
  main();
}