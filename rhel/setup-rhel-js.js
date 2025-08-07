#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');
const colorette = require('colorette');
const jsonc = require('jsonc-parser');

// --- Configuration (Mirrors the Bash script's variables) ---
const SERVICE_NAME = 'dicomweb-proxy';
const SERVICE_USER = 'dicomweb';
const SERVICE_GROUP = 'dicomweb';
const INSTALL_DIR = '/opt/dicomweb-proxy';
const BINARY_NAME = 'dicomweb-proxy-linux';
const CONFIG_DIR = path.join(INSTALL_DIR, 'config');
const DATA_DIR = path.join(INSTALL_DIR, 'data');
const LOGS_DIR = path.join(INSTALL_DIR, 'logs');
const CERTS_DIR = path.join(INSTALL_DIR, 'certs');
const SYSTEMD_DIR = '/etc/systemd/system';

// Check for RUN_AS_ROOT environment variable
let runAsRoot = process.env.RUN_AS_ROOT === 'true';

// --- Logging Functions (Mirrors the Bash script's style) ---
const log = {
    info: (msg) => console.log(colorette.blue(`[INFO]`), msg),
    success: (msg) => console.log(colorette.green(`[SUCCESS]`), msg),
    warn: (msg) => console.log(colorette.yellow(`[WARN]`), msg),
    error: (msg) => console.log(colorette.red(`[ERROR]`), msg),
    detail: (msg) => console.log(colorette.magenta(`[DETAIL]`), ` ${msg}`),
};

// --- Helper for Running Shell Commands ---
function runCommand(command, { ignoreErrors = false, silent = false } = {}) {
    try {
        if (!silent) log.detail(`Executing: ${command}`);
        // The stdio: 'inherit' option pipes the command's output to our script's output
        return execSync(command, { stdio: 'inherit', encoding: 'utf-8' });
    } catch (error) {
        if (!ignoreErrors) {
            log.error(`Command failed: ${command}`);
            throw error; // Propagate the error to stop the script
        } else {
            log.warn(`Command failed but was ignored: ${command}`);
        }
    }
}

// --- Installation Steps as Functions ---

function checkRoot() {
    if (process.getuid() !== 0) {
        log.error('This script must be run as root (use sudo)');
        process.exit(1);
    }
}

function checkRhel() {
    if (!fs.existsSync('/etc/redhat-release')) {
        log.error('This script is designed for Red Hat Enterprise Linux, CentOS, or Fedora');
        process.exit(1);
    }
    const osInfo = fs.readFileSync('/etc/redhat-release', 'utf-8').trim();
    log.info(`Detected OS: ${osInfo}`);
}

function installDependencies() {
    log.info('Installing required packages...');
    const pkgManager = fs.existsSync('/usr/bin/dnf') ? 'dnf' : 'yum';
    log.detail(`Using package manager: ${pkgManager}`);
    runCommand(`${pkgManager} update -y`);
    runCommand(
        `${pkgManager} install -y firewalld policycoreutils-python-utils libcap jq`, 
        { ignoreErrors: true } // Match original script's behavior
    );
    log.success('Dependencies installed');
}

function createUser() {
    if (runAsRoot) {
        log.warn('Service will run as root (maximum compatibility mode)');
        return; // No user creation needed
    }

    log.info('Creating service user and group...');
    try {
        execSync(`getent group ${SERVICE_GROUP}`, { stdio: 'ignore' });
        log.detail(`Group ${SERVICE_GROUP} already exists`);
    } catch (e) {
        runCommand(`groupadd --system ${SERVICE_GROUP}`);
        log.success(`Created group: ${SERVICE_GROUP}`);
    }

    try {
        execSync(`getent passwd ${SERVICE_USER}`, { stdio: 'ignore' });
        log.detail(`User ${SERVICE_USER} already exists`);
    } catch (e) {
        runCommand(`useradd --system --gid ${SERVICE_GROUP} --shell /bin/false --home-dir ${INSTALL_DIR} --no-create-home --comment "DICOM Web Proxy Service" ${SERVICE_USER}`);
        log.success(`Created user: ${SERVICE_USER}`);
    }
}

function createDirectories() {
    log.info('Creating application directories...');
    const dirs = [INSTALL_DIR, CONFIG_DIR, DATA_DIR, LOGS_DIR, CERTS_DIR];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            log.detail(`Created directory: ${dir}`);
        }
    });

    log.info('Setting directory permissions...');
    const user = runAsRoot ? 'root' : SERVICE_USER;
    const group = runAsRoot ? 'root' : SERVICE_GROUP;
    runCommand(`chown -R ${user}:${group} ${INSTALL_DIR}`);
    runCommand(`chmod 755 ${INSTALL_DIR}`);
    runCommand(`chmod 755 ${CONFIG_DIR}`);
    runCommand(`chmod 750 ${DATA_DIR}`);
    runCommand(`chmod 750 ${LOGS_DIR}`);
    runCommand(`chmod 750 ${CERTS_DIR}`);
    log.success('Directories created and configured');
}

/**
 * Parses the JSONC config file and returns a configuration object.
 * This function replaces the complex Python blob in the original script.
 * @param {string} configFile - Path to the config.jsonc file.
 * @returns {object} - The parsed configuration.
 */
function getConfig(configFile) {
    log.info(`Reading configuration from: ${configFile}`);
    if (!fs.existsSync(configFile)) {
        log.error(`Configuration file not found: ${configFile}`);
        throw new Error('Config file missing.');
    }
    const content = fs.readFileSync(configFile, 'utf-8');
    const errors = [];
    const config = jsonc.parse(content, errors);

    if (errors.length > 0) {
        log.error('Failed to parse config.jsonc. Please check for syntax errors.');
        errors.forEach(e => log.error(`Parse error: ${jsonc.printParseErrorCode(e.error)} at offset ${e.offset}`));
        throw new Error('Invalid JSONC.');
    }
    
    // Set defaults
    const finalConfig = {
        proxyMode: config.proxyMode,
        httpPort: config.webserverPort || '3006',
        sslEnabled: config.ssl?.enabled || false,
        sslPort: config.ssl?.port || '443',
        certPath: config.ssl?.certPath || '',
        keyPath: config.ssl?.keyPath || '',
        dimsePort: config.dimseProxySettings?.proxyServer?.port || '8888'
    };
    
    // Validate required fields
    if (!finalConfig.proxyMode) {
        throw new Error("Missing required field in config: proxyMode");
    }
    if (!['dimse', 'dicomweb'].includes(finalConfig.proxyMode)) {
        throw new Error(`Invalid proxyMode: ${finalConfig.proxyMode} (must be 'dimse' or 'dicomweb')`);
    }

    log.success('Configuration validated successfully');
    log.detail(`Proxy Mode: ${finalConfig.proxyMode}`);
    log.detail(`HTTP Port: ${finalConfig.httpPort}`);
    log.detail(`SSL Enabled: ${finalConfig.sslEnabled}`);
    return finalConfig;
}

function installApplication() {
    log.info('Installing application files...');
    const sourceBinary = path.join('.', BINARY_NAME);
    if (!fs.existsSync(sourceBinary)) {
        log.error(`Binary ${BINARY_NAME} not found in current directory: ${process.cwd()}`);
        process.exit(1);
    }

    const wasRunning = execSync(`systemctl is-active --quiet ${SERVICE_NAME} || echo "inactive"`).toString().trim() === 'active';
    if (wasRunning) {
        log.info('Stopping service for upgrade...');
        runCommand(`systemctl stop ${SERVICE_NAME}`);
    }

    const destBinary = path.join(INSTALL_DIR, BINARY_NAME);
    if (fs.existsSync(destBinary)) {
        const backupName = `${destBinary}.backup.${new Date().toISOString().replace(/:/g, '-')}`;
        fs.copyFileSync(destBinary, backupName);
        log.detail(`Backed up existing binary to: ${backupName}`);
    }

    fs.copyFileSync(sourceBinary, destBinary);
    fs.chmodSync(destBinary, 0o755);
    const user = runAsRoot ? 'root' : SERVICE_USER;
    const group = runAsRoot ? 'root' : SERVICE_GROUP;
    runCommand(`chown ${user}:${group} ${destBinary}`);
    log.success(`Binary installed to: ${destBinary}`);

    if (!runAsRoot) {
        log.info('Setting port binding capabilities...');
        runCommand(`setcap cap_net_bind_service=+ep ${destBinary}`, { ignoreErrors: true });
        runCommand(`getcap ${destBinary}`);
    }
    
    const sourceConfigDir = './config';
    if (fs.existsSync(sourceConfigDir)) {
        fs.readdirSync(sourceConfigDir).forEach(file => {
            fs.copyFileSync(path.join(sourceConfigDir, file), path.join(CONFIG_DIR, file));
        });
        runCommand(`chown -R ${user}:${group} ${CONFIG_DIR}`);
        runCommand(`chmod 644 ${CONFIG_DIR}/*`);
        log.success(`Configuration files copied to: ${CONFIG_DIR}`);
    } else {
        log.warn('No config directory found in current directory, skipping copy.');
    }
    
    if (wasRunning) {
        log.info('Restarting service...');
        runCommand(`systemctl start ${SERVICE_NAME}`);
    }
}

function installService() {
    log.info('Installing systemd service...');
    const serviceFile = 'dicomweb-proxy.service';
    const destServiceFile = path.join(SYSTEMD_DIR, `${SERVICE_NAME}.service`);

    if (fs.existsSync(`./${serviceFile}`)) {
        fs.copyFileSync(`./${serviceFile}`, destServiceFile);
        if (runAsRoot) {
            log.detail('Updating service file to run as root...');
            runCommand(`sed -i "s/^User=.*/User=root/" ${destServiceFile}`);
            runCommand(`sed -i "s/^Group=.*/Group=root/" ${destServiceFile}`);
        }
    } else {
        log.warn('Service file not found, creating a default one...');
        const user = runAsRoot ? 'root' : SERVICE_USER;
        const group = runAsRoot ? 'root' : SERVICE_GROUP;
        const serviceContent = `
[Unit]
Description=DICOM Web Proxy Service
After=network.target

[Service]
Type=simple
User=${user}
Group=${group}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/${BINARY_NAME}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
`;
        fs.writeFileSync(destServiceFile, serviceContent.trim());
    }

    fs.chmodSync(destServiceFile, 0o644);
    log.detail(`Service file installed to: ${destServiceFile}`);
    runCommand('systemctl daemon-reload');
    runCommand(`systemctl enable ${SERVICE_NAME}`);
    log.success('Systemd service installed and enabled');
}

function installCertificates(config) {
    if (!config.sslEnabled) {
        log.info('SSL is disabled in configuration, skipping certificate setup.');
        return;
    }

    log.info('SSL is enabled - setting up certificates...');
    const standardCert = path.join(CERTS_DIR, 'server.crt');
    const standardKey = path.join(CERTS_DIR, 'server.key');

    if (!config.certPath || !config.keyPath) {
        throw new Error('SSL is enabled but certPath or keyPath are not specified in config.jsonc');
    }
    if (!fs.existsSync(config.certPath)) {
        throw new Error(`SSL certificate not found at: ${config.certPath}`);
    }
    if (!fs.existsSync(config.keyPath)) {
        throw new Error(`SSL private key not found at: ${config.keyPath}`);
    }
    
    log.success('Found certificates at configured paths.');
    fs.copyFileSync(config.certPath, standardCert);
    fs.copyFileSync(config.keyPath, standardKey);
    
    const user = runAsRoot ? 'root' : SERVICE_USER;
    const group = runAsRoot ? 'root' : SERVICE_GROUP;
    runCommand(`chown ${user}:${group} ${standardCert} ${standardKey}`);
    fs.chmodSync(standardCert, 0o644);
    fs.chmodSync(standardKey, 0o600);
    log.success(`Certificates installed to: ${CERTS_DIR}`);
    
    log.info('Updating configuration to use standard certificate paths...');
    const configPath = path.join(CONFIG_DIR, 'config.jsonc');
    // Using sed for a simple replacement to preserve comments and formatting, same as the original script.
    runCommand(`sed -i 's|"certPath".*:[^,]*|"certPath": "${standardCert}"|' ${configPath}`, { ignoreErrors: true });
    runCommand(`sed -i 's|"keyPath".*:[^,]*|"keyPath": "${standardKey}"|' ${configPath}`, { ignoreErrors: true });
}

function configureFirewall(config) {
    log.info('Configuring firewall...');
    try {
        execSync('command -v firewall-cmd', { stdio: 'ignore' });
    } catch (e) {
        log.warn('firewalld not installed - skipping firewall configuration.');
        return;
    }

    runCommand('systemctl start firewalld', { ignoreErrors: true });
    runCommand('systemctl enable firewalld', { ignoreErrors: true });

    const ports = [config.httpPort, config.sslEnabled ? config.sslPort : null, config.dimsePort].filter(Boolean);
    log.info(`Opening firewall ports: ${ports.join(', ')}`);
    ports.forEach(port => {
        runCommand(`firewall-cmd --permanent --add-port=${port}/tcp`, { ignoreErrors: true });
    });
    runCommand('firewall-cmd --reload');
    log.success('Firewall configured and reloaded.');
    log.detail('Current open ports:');
    runCommand('firewall-cmd --list-ports');
}

function configureSelinux() {
    log.info('Configuring SELinux...');
    try {
        const status = execSync('getenforce', { encoding: 'utf-8' }).trim();
        log.detail(`SELinux status: ${status}`);
        if (status === 'Disabled') {
            log.info('SELinux is disabled - skipping configuration.');
            return;
        }

        runCommand('setsebool -P httpd_can_network_connect 1', { ignoreErrors: true });
        log.detail('Set SELinux boolean: httpd_can_network_connect=1');

        const destBinary = path.join(INSTALL_DIR, BINARY_NAME);
        runCommand(`chcon -t bin_t ${destBinary}`, { ignoreErrors: true });
        log.detail('Set SELinux context for binary.');

        log.success('SELinux configuration completed.');
    } catch (e) {
        log.warn('SELinux tools not found or failed, skipping.');
    }
}

function showUsage(config) {
    console.log(colorette.bold('\n=========================================='));
    console.log(colorette.bold('   DICOM Web Proxy Installation Complete'));
    console.log(colorette.bold('==========================================\n'));
    log.info(`Install Directory: ${INSTALL_DIR}`);
    log.info(`Service User: ${runAsRoot ? 'root' : SERVICE_USER}`);
    log.info(`Configuration: ${path.join(CONFIG_DIR, 'config.jsonc')}`);
    
    if (config) {
        console.log('\nService Endpoints:');
        log.detail(`HTTP: http://localhost:${config.httpPort}`);
        if (config.sslEnabled) {
            log.detail(`HTTPS: https://localhost:${config.sslPort}`);
        }
        log.detail(`DIMSE: port ${config.dimsePort}`);
    }

    console.log('\nService Management Commands:');
    log.detail(`Start:   sudo systemctl start ${SERVICE_NAME}`);
    log.detail(`Stop:    sudo systemctl stop ${SERVICE_NAME}`);
    log.detail(`Restart: sudo systemctl restart ${SERVICE_NAME}`);
    log.detail(`Status:  sudo systemctl status ${SERVICE_NAME}`);
    log.detail(`Logs:    sudo journalctl -u ${SERVICE_NAME} -f`);
    console.log(colorette.bold('\n==========================================\n'));
}

async function uninstall() {
    checkRoot();
    log.info('Uninstalling DICOM Web Proxy...');
    runCommand(`systemctl stop ${SERVICE_NAME}`, { ignoreErrors: true });
    runCommand(`systemctl disable ${SERVICE_NAME}`, { ignoreErrors: true });
    const serviceFile = path.join(SYSTEMD_DIR, `${SERVICE_NAME}.service`);
    if (fs.existsSync(serviceFile)) fs.unlinkSync(serviceFile);
    runCommand('systemctl daemon-reload');

    try {
        const config = getConfig(path.join(CONFIG_DIR, 'config.jsonc'));
        const ports = [config.httpPort, config.sslEnabled ? config.sslPort : null, config.dimsePort].filter(Boolean);
        ports.forEach(port => {
            runCommand(`firewall-cmd --permanent --remove-port=${port}/tcp`, { ignoreErrors: true });
        });
        runCommand('firewall-cmd --reload', { ignoreErrors: true });
    } catch (e) {
        log.warn('Could not read config to remove firewall rules. You may need to remove them manually.');
    }
    
    if (!runAsRoot) {
        runCommand(`userdel ${SERVICE_USER}`, { ignoreErrors: true });
        runCommand(`groupdel ${SERVICE_GROUP}`, { ignoreErrors: true });
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Remove all application files at ${INSTALL_DIR}? (y/N) `, answer => {
        if (answer.toLowerCase() === 'y') {
            runCommand(`rm -rf ${INSTALL_DIR}`);
            log.success('All files removed.');
        } else {
            log.info(`Files preserved at ${INSTALL_DIR}`);
        }
        rl.close();
        log.success('Uninstallation completed.');
    });
}

// --- Main Execution Logic ---
async function main() {
    const command = process.argv[2] || 'install';

    switch (command) {
        case 'install':
            try {
                log.info('Starting DICOM Web Proxy installation...');
                log.info(`Install mode: ${runAsRoot ? 'ROOT (maximum compatibility)' : 'SERVICE USER (secure)'}`);
                checkRoot();
                checkRhel();
                const config = getConfig('./config/config.jsonc');
                
                installDependencies();
                createUser();
                createDirectories();
                installApplication();
                installService();
                installCertificates(config);
                configureFirewall(config);
                configureSelinux();
                
                showUsage(config);
            } catch (error) {
                log.error(`Installation failed: ${error.message}`);
                process.exit(1);
            }
            break;
        
        case 'uninstall':
            await uninstall();
            break;
        
        case 'test':
            // Add a test function if desired
            log.info('Test functionality not yet implemented.');
            break;

        default:
            console.log(`Usage: ${path.basename(process.argv[1])} [install|uninstall|test]`);
            console.log("Set RUN_AS_ROOT=true to run the service as the root user.");
            break;
    }
}

main();