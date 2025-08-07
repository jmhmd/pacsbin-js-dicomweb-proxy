#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { parse as parseJsonc } from "jsonc-parser";
import { ProxyConfig } from "./types";
import { validateConfig } from "./config/validation";

interface InstallationOptions {
  forceRoot?: boolean;
  runAsRoot?: string; // Environment variable
}

class Logger {
  private static readonly colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    reset: '\x1b[0m'
  };

  static info(message: string): void {
    console.log(`${this.colors.blue}[INFO]${this.colors.reset} ${message}`);
  }

  static success(message: string): void {
    console.log(`${this.colors.green}[SUCCESS]${this.colors.reset} ${message}`);
  }

  static warn(message: string): void {
    console.log(`${this.colors.yellow}[WARN]${this.colors.reset} ${message}`);
  }

  static error(message: string): void {
    console.log(`${this.colors.red}[ERROR]${this.colors.reset} ${message}`);
  }

  static detail(message: string): void {
    console.log(`${this.colors.magenta}[DETAIL]${this.colors.reset} ${message}`);
  }
}

export class RhelInstaller {
  private readonly constants = {
    serviceName: 'dicomweb-proxy',
    serviceUser: 'dicomweb',
    serviceGroup: 'dicomweb',
    installDir: '/opt/dicomweb-proxy',
    binaryName: 'dicomweb-proxy-linux',
    configDir: '/opt/dicomweb-proxy/config',
    dataDir: '/opt/dicomweb-proxy/data',
    logsDir: '/opt/dicomweb-proxy/logs',
    certsDir: '/opt/dicomweb-proxy/certs',
    systemdDir: '/etc/systemd/system'
  };

  private forceRoot: boolean = false;
  private config: ProxyConfig | null = null;

  constructor(options: InstallationOptions = {}) {
    this.forceRoot = options.forceRoot || 
                     options.runAsRoot === 'true' || 
                     process.env['RUN_AS_ROOT'] === 'true';
  }

  private validateConfigFile(configPath: string): ProxyConfig {
    Logger.info(`Validating configuration file: ${configPath}`);
    
    if (!existsSync(configPath)) {
      Logger.error(`Configuration file not found: ${configPath}`);
      Logger.error('Please ensure the config directory exists with a valid config.jsonc file');
      process.exit(1);
    }

    try {
      const configContent = readFileSync(configPath, 'utf-8');
      let rawConfig: any;
      
      try {
        // Try regular JSON first
        rawConfig = JSON.parse(configContent);
      } catch (jsonError) {
        try {
          // Fall back to JSONC parser
          rawConfig = parseJsonc(configContent);
        } catch (jsoncError) {
          throw new Error(`Failed to parse configuration file as JSON or JSONC: ${jsoncError}`);
        }
      }

      const validatedConfig = validateConfig(rawConfig);
      Logger.success('Configuration validated successfully');
      return validatedConfig;
      
    } catch (error) {
      Logger.error('Configuration validation failed:');
      if (error instanceof Error) {
        const errorLines = error.message.split('\n');
        errorLines.forEach(line => {
          if (line.trim()) {
            Logger.error(`  ${line}`);
          }
        });
      }
      Logger.error('Please fix the configuration file and try again.');
      process.exit(1);
    }
  }

  private execCommand(command: string, description?: string, allowFailure: boolean = false): string {
    if (description) {
      Logger.detail(`Executing: ${description}`);
    }
    
    try {
      const result = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
      return result.toString().trim();
    } catch (error) {
      if (!allowFailure) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.error(`Command failed: ${command}`);
        Logger.error(`Error: ${errorMessage}`);
        throw error;
      }
      return '';
    }
  }

  private checkRoot(): void {
    if (process.getuid && process.getuid() !== 0) {
      Logger.error('This installer must be run as root (use sudo)');
      process.exit(1);
    }
  }

  private checkRhel(): void {
    if (!existsSync('/etc/redhat-release')) {
      Logger.error('This installer is designed for Red Hat Enterprise Linux, CentOS, or Fedora');
      process.exit(1);
    }
    
    const osInfo = readFileSync('/etc/redhat-release', 'utf-8').trim();
    Logger.info(`Detected OS: ${osInfo}`);
    return;
  }

  private detectPackageManager(): 'dnf' | 'yum' {
    try {
      this.execCommand('which dnf', undefined, true);
      Logger.detail('Using package manager: dnf');
      return 'dnf';
    } catch (error) {
      try {
        this.execCommand('which yum', undefined, true);
        Logger.detail('Using package manager: yum');
        return 'yum';
      } catch (error) {
        Logger.error('Neither dnf nor yum package manager found');
        process.exit(1);
      }
    }
  }

  private installDependencies(): void {
    Logger.info('Installing required packages...');
    
    const packageManager = this.detectPackageManager();
    
    try {
      // Update package lists
      this.execCommand(`${packageManager} update -y`, 'Updating package lists');
      
      // Install required packages
      const packages = [
        'firewalld',
        'policycoreutils-python-utils',
        'libcap'
      ];
      
      this.execCommand(
        `${packageManager} install -y ${packages.join(' ')}`,
        'Installing system packages',
        true
      );
      
      Logger.success('Dependencies installed');
    } catch (error) {
      Logger.warn('Some packages failed to install, continuing anyway...');
    }
  }

  private createServiceUser(): void {
    if (this.forceRoot) {
      Logger.warn('Service will run as root (maximum compatibility mode)');
      return;
    }

    Logger.info('Creating service user and group...');
    
    try {
      // Check if group exists, create if it doesn't
      const groupCheckResult = this.execCommand(`getent group ${this.constants.serviceGroup}`, undefined, true);
      if (groupCheckResult.trim()) {
        Logger.detail(`Group ${this.constants.serviceGroup} already exists`);
      } else {
        this.execCommand(`groupadd --system ${this.constants.serviceGroup}`, 'Creating service group');
        Logger.success(`Created group: ${this.constants.serviceGroup}`);
      }

      // Check if user exists, create if it doesn't  
      const userCheckResult = this.execCommand(`getent passwd ${this.constants.serviceUser}`, undefined, true);
      if (userCheckResult.trim()) {
        Logger.detail(`User ${this.constants.serviceUser} already exists`);
      } else {
        this.execCommand(
          `useradd --system --gid ${this.constants.serviceGroup} --shell /bin/false --home-dir ${this.constants.installDir} --no-create-home --comment "DICOM Web Proxy Service" ${this.constants.serviceUser}`,
          'Creating service user'
        );
        Logger.success(`Created user: ${this.constants.serviceUser}`);
      }
    } catch (error) {
      Logger.warn('Failed to create service user - switching to root mode for maximum compatibility');
      this.forceRoot = true;
    }
  }

  private createDirectories(): void {
    Logger.info('Creating application directories...');
    
    const directories = [
      this.constants.installDir,
      this.constants.configDir,
      this.constants.dataDir,
      this.constants.logsDir,
      this.constants.certsDir
    ];

    for (const dir of directories) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      Logger.detail(`Created/verified directory: ${dir}`);
    }

    Logger.info('Setting directory permissions...');
    
    const user = this.forceRoot ? 'root' : this.constants.serviceUser;
    const group = this.forceRoot ? 'root' : this.constants.serviceGroup;
    
    this.execCommand(`chown -R ${user}:${group} ${this.constants.installDir}`, 'Setting directory ownership');
    this.execCommand(`chmod 755 ${this.constants.installDir}`, 'Setting install directory permissions');
    this.execCommand(`chmod 755 ${this.constants.configDir}`, 'Setting config directory permissions');
    this.execCommand(`chmod 750 ${this.constants.dataDir}`, 'Setting data directory permissions');
    this.execCommand(`chmod 750 ${this.constants.logsDir}`, 'Setting logs directory permissions');
    this.execCommand(`chmod 750 ${this.constants.certsDir}`, 'Setting certs directory permissions');
    
    Logger.detail(`Owner set to: ${user}:${group}`);
    Logger.success('Directories created and configured');
  }

  private installBinary(): void {
    Logger.info('Installing application files...');
    
    const currentBinaryPath = `./${this.constants.binaryName}`;
    if (!existsSync(currentBinaryPath)) {
      Logger.error(`Binary ${this.constants.binaryName} not found in current directory`);
      Logger.error(`Current directory: ${process.cwd()}`);
      Logger.error('Files in current directory:');
      this.execCommand('ls -la', undefined, true);
      process.exit(1);
    }

    Logger.detail(`Found binary: ${process.cwd()}/${this.constants.binaryName}`);

    // Stop service if running
    let wasRunning = false;
    const serviceStatus = this.execCommand(`systemctl is-active --quiet ${this.constants.serviceName}`, undefined, true);
    if (serviceStatus.trim() || serviceStatus === '') {
      // Check if service exists and is active
      const serviceExists = this.execCommand(`systemctl status ${this.constants.serviceName}`, undefined, true);
      if (serviceExists.includes('active') || serviceExists.includes('inactive')) {
        Logger.info('Stopping service for binary upgrade...');
        this.execCommand(`systemctl stop ${this.constants.serviceName}`, 'Stopping service', true);
        wasRunning = true;
      }
    }

    const targetBinaryPath = join(this.constants.installDir, this.constants.binaryName);
    
    // Backup existing binary
    if (existsSync(targetBinaryPath)) {
      const backupName = `${targetBinaryPath}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
      this.execCommand(`cp ${targetBinaryPath} ${backupName}`, `Backing up existing binary to ${backupName}`);
    }

    // Copy binary
    this.execCommand(`cp ${currentBinaryPath} ${targetBinaryPath}`, 'Installing binary');
    this.execCommand(`chmod 755 ${targetBinaryPath}`, 'Setting binary permissions');
    
    const user = this.forceRoot ? 'root' : this.constants.serviceUser;
    const group = this.forceRoot ? 'root' : this.constants.serviceGroup;
    this.execCommand(`chown ${user}:${group} ${targetBinaryPath}`, 'Setting binary ownership');
    
    Logger.success(`Binary installed to: ${targetBinaryPath}`);
    Logger.detail(`Binary permissions: 755, owner: ${user}:${group}`);

    // Set capabilities for port binding (always set for maximum reliability)
    try {
      this.execCommand(`setcap cap_net_bind_service=+ep ${targetBinaryPath}`, 'Setting port binding capabilities');
      Logger.success('Set port binding capabilities on binary');
      
      const caps = this.execCommand(`getcap ${targetBinaryPath}`, undefined, true);
      Logger.detail(`Binary capabilities: ${caps || 'none'}`);
    } catch (error) {
      if (this.forceRoot) {
        Logger.warn('setcap not available - continuing anyway (running as root)');
      } else {
        Logger.warn('setcap not available - service may not bind to privileged ports');
        Logger.warn('Consider using --root flag for maximum compatibility');
      }
    }

    // Copy configuration files
    if (existsSync('./config')) {
      const configFile = join(this.constants.configDir, 'config.jsonc');
      
      // Backup existing config
      if (existsSync(configFile)) {
        const backupName = `${configFile}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
        this.execCommand(`cp ${configFile} ${backupName}`, `Backing up existing config to ${backupName}`);
      }
      
      this.execCommand(`cp -r ./config/* ${this.constants.configDir}/`, 'Copying configuration files');
      this.execCommand(`chown -R ${user}:${group} ${this.constants.configDir}`, 'Setting config ownership');
      this.execCommand(`chmod 644 ${this.constants.configDir}/*`, 'Setting config permissions', true);
      Logger.success(`Configuration files copied to: ${this.constants.configDir}`);
    } else {
      Logger.warn('No config directory found in current directory');
    }

    // Restart service if it was running
    if (wasRunning) {
      Logger.info('Restarting service...');
      this.execCommand(`systemctl start ${this.constants.serviceName}`, 'Starting service');
      Logger.success('Service restarted');
    }
  }

  private createSystemdService(): void {
    Logger.info('Installing systemd service...');
    
    const user = this.forceRoot ? 'root' : this.constants.serviceUser;
    const group = this.forceRoot ? 'root' : this.constants.serviceGroup;
    
    const serviceContent = `[Unit]
Description=DICOM Web Proxy Service
After=network.target

[Service]
Type=simple
User=${user}
Group=${group}
WorkingDirectory=${this.constants.installDir}
ExecStart=${this.constants.installDir}/${this.constants.binaryName}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${this.constants.serviceName}

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target`;

    const serviceFilePath = join(this.constants.systemdDir, `${this.constants.serviceName}.service`);
    writeFileSync(serviceFilePath, serviceContent);
    this.execCommand(`chmod 644 ${serviceFilePath}`, 'Setting service file permissions');
    
    Logger.detail(`Service file installed: ${serviceFilePath}`);
    Logger.detail('Service configuration:');
    Logger.detail(`  User=${user}`);
    Logger.detail(`  Group=${group}`);
    Logger.detail(`  ExecStart=${this.constants.installDir}/${this.constants.binaryName}`);
    Logger.detail(`  WorkingDirectory=${this.constants.installDir}`);

    // Reload systemd and enable service
    this.execCommand('systemctl daemon-reload', 'Reloading systemd');
    this.execCommand(`systemctl enable ${this.constants.serviceName}`, 'Enabling service');
    
    Logger.success('Systemd service installed and enabled');
  }

  private installCertificates(): void {
    Logger.info('Configuring SSL certificates...');
    
    if (!this.config) {
      Logger.error('Configuration not loaded - cannot configure certificates');
      return;
    }

    if (!this.config.ssl.enabled) {
      Logger.info('SSL is disabled in configuration - skipping certificate setup');
      return;
    }

    Logger.info('SSL is enabled - setting up certificates');
    
    const standardCert = join(this.constants.certsDir, 'server.crt');
    const standardKey = join(this.constants.certsDir, 'server.key');
    
    Logger.detail('Application will look for certificates at:');
    Logger.detail(`  Certificate: ${standardCert}`);
    Logger.detail(`  Private Key: ${standardKey}`);

    if (!this.config.ssl.certPath || !this.config.ssl.keyPath) {
      Logger.error('SSL is enabled but certificate paths are not specified in configuration');
      Logger.error('Please set certPath and keyPath in the ssl section of your config.jsonc');
      process.exit(1);
    }

    if (!existsSync(this.config.ssl.certPath)) {
      Logger.error(`SSL certificate not found at configured path: ${this.config.ssl.certPath}`);
      Logger.error('Please ensure the certificate file exists at this path, or update the certPath in config.jsonc');
      process.exit(1);
    }

    if (!existsSync(this.config.ssl.keyPath)) {
      Logger.error(`SSL private key not found at configured path: ${this.config.ssl.keyPath}`);
      Logger.error('Please ensure the private key file exists at this path, or update the keyPath in config.jsonc');
      process.exit(1);
    }

    Logger.success('Found certificates at configured paths!');
    Logger.detail(`  Certificate: ${this.config.ssl.certPath}`);
    Logger.detail(`  Private Key: ${this.config.ssl.keyPath}`);

    // Backup existing certificates
    for (const file of [standardCert, standardKey]) {
      if (existsSync(file)) {
        const backup = `${file}.backup.${new Date().toISOString().replace(/[:.]/g, '-')}`;
        this.execCommand(`cp ${file} ${backup}`, `Backing up ${file}`);
      }
    }

    // Copy to standard location
    this.execCommand(`cp ${this.config.ssl.certPath} ${standardCert}`, 'Installing certificate');
    this.execCommand(`cp ${this.config.ssl.keyPath} ${standardKey}`, 'Installing private key');

    // Set permissions
    const user = this.forceRoot ? 'root' : this.constants.serviceUser;
    const group = this.forceRoot ? 'root' : this.constants.serviceGroup;
    
    this.execCommand(`chown ${user}:${group} ${standardCert} ${standardKey}`, 'Setting certificate ownership');
    this.execCommand(`chmod 644 ${standardCert}`, 'Setting certificate permissions');
    this.execCommand(`chmod 600 ${standardKey}`, 'Setting private key permissions');

    Logger.success('Certificates installed to standard location');
    Logger.detail(`Permissions set: cert=644, key=600, owner=${user}:${group}`);

    // Update configuration to use standard paths
    Logger.info('Updating configuration to use standard certificate paths...');
    const configFile = join(this.constants.configDir, 'config.jsonc');
    try {
      const configContent = readFileSync(configFile, 'utf-8');
      
      // Parse the JSONC, update paths, and write back
      let configObj: any;
      try {
        configObj = JSON.parse(configContent);
      } catch (jsonError) {
        configObj = parseJsonc(configContent);
      }
      
      // Update the certificate paths
      if (configObj.ssl) {
        configObj.ssl.certPath = standardCert;
        configObj.ssl.keyPath = standardKey;
      }
      
      // Write back with proper JSON formatting
      writeFileSync(configFile, JSON.stringify(configObj, null, 2));
      Logger.detail('Configuration updated to use standard paths');
    } catch (error) {
      Logger.warn('Could not update configuration file - manual update may be needed');
      Logger.warn('Please manually update certPath and keyPath in config.jsonc');
    }
  }

  private configureFirewall(): void {
    Logger.info('Configuring firewall...');
    
    try {
      this.execCommand('which firewall-cmd', undefined, true);
    } catch (error) {
      Logger.warn('firewalld not installed - skipping firewall configuration');
      Logger.warn('Manual firewall configuration may be required');
      return;
    }

    // Start firewalld if not running
    const firewalldStatus = this.execCommand('systemctl is-active --quiet firewalld', undefined, true);
    if (!firewalldStatus.trim()) {
      try {
        this.execCommand('systemctl start firewalld', 'Starting firewalld');
        this.execCommand('systemctl enable firewalld', 'Enabling firewalld');
        Logger.detail('Started and enabled firewalld');
      } catch (error) {
        Logger.warn('Could not start firewalld - continuing without firewall configuration');
        return;
      }
    }

    if (!this.config) {
      Logger.warn('Configuration not loaded - using default ports');
      return;
    }

    const ports = [
      this.config.webserverPort,
      this.config.ssl.enabled ? this.config.ssl.port : null,
      this.config.proxyMode === 'dimse' && this.config.dimseProxySettings ? 
        this.config.dimseProxySettings.proxyServer.port : null
    ].filter(port => port !== null);

    Logger.info('Opening firewall ports...');
    ports.forEach(port => {
      Logger.detail(`  Port: ${port}`);
    });

    for (const port of ports) {
      try {
        this.execCommand(`firewall-cmd --permanent --add-port=${port}/tcp`, undefined, true);
        Logger.detail(`Added firewall rule for port ${port}/tcp`);
      } catch (error) {
        Logger.warn(`Failed to add firewall rule for port ${port}`);
      }
    }

    const reloadResult = this.execCommand('firewall-cmd --reload', 'Reloading firewall', true);
    if (reloadResult) {
      Logger.success('Firewall configured and reloaded');
      
      const openPorts = this.execCommand('firewall-cmd --list-ports', undefined, true);
      if (openPorts) {
        Logger.detail('Current open ports:');
        Logger.detail(`  ${openPorts}`);
      }
    } else {
      Logger.warn('Failed to reload firewall - rules may not be active');
    }
  }

  private configureSelinux(): void {
    Logger.info('Configuring SELinux...');
    
    try {
      const selinuxStatus = this.execCommand('getenforce', undefined, true);
      Logger.detail(`SELinux status: ${selinuxStatus}`);
      
      if (selinuxStatus === 'Disabled') {
        Logger.info('SELinux is disabled - skipping configuration');
        return;
      }

      // Set basic permissions
      try {
        this.execCommand('setsebool -P httpd_can_network_connect 1', 'Setting SELinux boolean', true);
        Logger.detail('Set SELinux boolean: httpd_can_network_connect=1');
      } catch (error) {
        Logger.warn('Failed to set SELinux boolean');
      }

      // Set context for binary
      try {
        this.execCommand(`chcon -t bin_t ${this.constants.installDir}/${this.constants.binaryName}`, 'Setting SELinux context', true);
        Logger.detail('Set SELinux context for binary');
      } catch (error) {
        Logger.warn('Failed to set SELinux context for binary');
      }

      Logger.success('SELinux configuration completed');
      
      if (selinuxStatus === 'Enforcing') {
        Logger.warn('If the service fails to start due to SELinux, you can:');
        Logger.warn('  1. Temporarily disable SELinux: setenforce 0');
        Logger.warn('  2. Or reinstall with: --root flag for maximum compatibility');
      }
    } catch (error) {
      Logger.detail('SELinux tools not installed - skipping');
    }
  }

  private testInstallation(): void {
    Logger.info('Testing installation...');
    
    const binaryPath = join(this.constants.installDir, this.constants.binaryName);
    const configFile = join(this.constants.configDir, 'config.jsonc');
    const serviceFile = join(this.constants.systemdDir, `${this.constants.serviceName}.service`);
    
    // Check if binary is executable
    if (existsSync(binaryPath)) {
      try {
        const stats = statSync(binaryPath);
        if (stats.mode & parseInt('111', 8)) {
          Logger.success('Binary is executable');
        } else {
          Logger.error('Binary is not executable');
        }
      } catch (error) {
        // Use ls command as fallback
        const lsResult = this.execCommand(`ls -la ${binaryPath}`, undefined, true);
        if (lsResult && lsResult.includes('x')) {
          Logger.success('Binary is executable');
        } else {
          Logger.warn('Could not verify binary permissions, but binary exists');
        }
      }
    } else {
      Logger.error('Binary not found');
    }

    // Check if configuration is valid
    try {
      this.validateConfigFile(configFile);
      Logger.success('Configuration is valid');
    } catch (error) {
      Logger.error('Configuration validation failed');
    }

    // Check if service file exists
    if (existsSync(serviceFile)) {
      Logger.success('Service file exists');
    } else {
      Logger.error('Service file missing');
    }

    // Check certificate files if SSL is enabled
    if (this.config && this.config.ssl.enabled) {
      const certExists = existsSync(join(this.constants.certsDir, 'server.crt'));
      const keyExists = existsSync(join(this.constants.certsDir, 'server.key'));
      
      if (certExists && keyExists) {
        Logger.success('SSL certificates found');
      } else {
        Logger.error('SSL certificates missing');
      }
    }

    Logger.info('Installation test complete');
  }

  private showUsage(): void {
    console.log('');
    console.log('==========================================');
    console.log('   DICOM Web Proxy Installation Complete');
    console.log('==========================================');
    console.log('');
    console.log('Installation Summary:');
    console.log(`  Install Directory: ${this.constants.installDir}`);
    console.log(`  Service User: ${this.forceRoot ? 'root' : this.constants.serviceUser}`);
    console.log(`  Configuration: ${this.constants.configDir}/config.jsonc`);
    
    if (this.config) {
      console.log('');
      console.log('Service Endpoints:');
      console.log(`  HTTP: http://localhost:${this.config.webserverPort}`);
      if (this.config.ssl.enabled) {
        console.log(`  HTTPS: https://localhost:${this.config.ssl.port}`);
      }
      if (this.config.proxyMode === 'dimse' && this.config.dimseProxySettings) {
        console.log(`  DIMSE: port ${this.config.dimseProxySettings.proxyServer.port}`);
      }
    }

    console.log('');
    console.log('Service Management Commands:');
    console.log(`  Start:   sudo systemctl start ${this.constants.serviceName}`);
    console.log(`  Stop:    sudo systemctl stop ${this.constants.serviceName}`);
    console.log(`  Restart: sudo systemctl restart ${this.constants.serviceName}`);
    console.log(`  Status:  sudo systemctl status ${this.constants.serviceName}`);
    console.log(`  Logs:    sudo journalctl -u ${this.constants.serviceName} -f`);
    
    console.log('');
    console.log('Quick Start:');
    console.log('  1. Start the service:');
    console.log(`     sudo systemctl start ${this.constants.serviceName}`);
    console.log('');
    console.log('  2. Check service status:');
    console.log(`     sudo systemctl status ${this.constants.serviceName}`);
    console.log('');
    console.log('  3. Monitor logs:');
    console.log(`     sudo journalctl -u ${this.constants.serviceName} -f`);

    if (this.config && this.config.ssl.enabled) {
      const certExists = existsSync(join(this.constants.certsDir, 'server.crt'));
      if (!certExists) {
        console.log('');
        console.log('⚠️  WARNING: SSL is enabled but certificates are missing!');
        console.log('   The service will fail to start. Please either:');
        console.log(`   - Install certificates to: ${this.constants.certsDir}/`);
        console.log(`   - Or disable SSL in: ${this.constants.configDir}/config.jsonc`);
      }
    }

    console.log('');
    console.log('Troubleshooting:');
    console.log('  If service fails to start:');
    console.log(`  - Check logs: journalctl -u ${this.constants.serviceName} -n 50`);
    console.log(`  - Verify config: cat ${this.constants.configDir}/config.jsonc`);
    console.log(`  - Check permissions: ls -la ${this.constants.installDir}/`);
    
    if (!this.forceRoot) {
      console.log('  - For maximum compatibility, reinstall with: --root flag');
    }

    console.log('');
    console.log('==========================================');
  }

  private convertServiceToRoot(): void {
    Logger.info('Converting service to run as root...');
    
    const serviceFile = join(this.constants.systemdDir, `${this.constants.serviceName}.service`);
    
    if (!existsSync(serviceFile)) {
      Logger.error('Service file not found - run install first');
      process.exit(1);
    }

    // Stop service
    try {
      this.execCommand(`systemctl stop ${this.constants.serviceName}`, 'Stopping service');
    } catch (error) {
      Logger.warn('Service was not running');
    }

    // Update service file
    let serviceContent = readFileSync(serviceFile, 'utf-8');
    serviceContent = serviceContent.replace(/^User=.*/m, 'User=root');
    serviceContent = serviceContent.replace(/^Group=.*/m, 'Group=root');
    writeFileSync(serviceFile, serviceContent);
    
    // Update file ownership
    this.execCommand(`chown -R root:root ${this.constants.installDir}`, 'Updating file ownership');
    
    // Reload and restart
    this.execCommand('systemctl daemon-reload', 'Reloading systemd');
    this.execCommand(`systemctl start ${this.constants.serviceName}`, 'Starting service as root');
    
    Logger.success('Service converted to run as root');
  }

  public async install(): Promise<void> {
    Logger.info('Starting DICOM Web Proxy installation...');
    const mode = this.forceRoot ? 'ROOT (maximum compatibility)' : 'SERVICE USER (secure)';
    Logger.info(`Install mode: ${mode}`);
    console.log('');
    
    this.checkRoot();
    this.checkRhel();
    
    // Validate configuration first
    const configFile = './config/config.jsonc';
    this.config = this.validateConfigFile(configFile);
    
    this.installDependencies();
    this.createServiceUser();
    this.createDirectories();
    this.installBinary();
    this.createSystemdService();
    this.installCertificates();
    this.configureFirewall();
    this.configureSelinux();
    this.testInstallation();
    this.showUsage();
  }

  public async testInstall(): Promise<void> {
    this.checkRoot();
    
    const configFile = join(this.constants.configDir, 'config.jsonc');
    if (existsSync(configFile)) {
      this.config = this.validateConfigFile(configFile);
    }
    
    this.testInstallation();
  }

  public async uninstall(): Promise<void> {
    this.checkRoot();
    Logger.info('Uninstalling DICOM Web Proxy...');
    
    // Stop and disable service
    try {
      this.execCommand(`systemctl stop ${this.constants.serviceName}`, 'Stopping service', true);
      this.execCommand(`systemctl disable ${this.constants.serviceName}`, 'Disabling service', true);
      this.execCommand(`rm -f ${this.constants.systemdDir}/${this.constants.serviceName}.service`, 'Removing service file', true);
      this.execCommand('systemctl daemon-reload', 'Reloading systemd');
    } catch (error) {
      Logger.warn('Error during service removal');
    }

    // Remove firewall rules
    try {
      this.execCommand('which firewall-cmd', undefined, true);
      const ports = ['3006', '443', '8888']; // Default ports
      for (const port of ports) {
        this.execCommand(`firewall-cmd --permanent --remove-port=${port}/tcp`, undefined, true);
      }
      this.execCommand('firewall-cmd --reload', undefined, true);
      Logger.detail('Removed firewall rules');
    } catch (error) {
      // firewalld not available or rules don't exist
    }

    // Remove service user
    const currentUser = this.execCommand('whoami', undefined, true);
    if (currentUser !== 'root') {
      try {
        this.execCommand(`userdel ${this.constants.serviceUser}`, 'Removing service user', true);
        this.execCommand(`groupdel ${this.constants.serviceGroup}`, 'Removing service group', true);
      } catch (error) {
        Logger.warn('Could not remove service user/group');
      }
    }

    // Ask before removing files
    console.log('');
    console.log(`Remove all application files at ${this.constants.installDir}? (y/N)`);
    
    // For automated uninstall, we'll skip the prompt and preserve files
    Logger.info(`Files preserved at ${this.constants.installDir}`);
    Logger.info('To remove files manually: rm -rf /opt/dicomweb-proxy');

    Logger.success('Uninstallation completed');
  }

  public async convertToRoot(): Promise<void> {
    this.checkRoot();
    this.convertServiceToRoot();
  }
}

export async function runInstaller(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  
  let options: InstallationOptions = {};
  
  if (args.includes('--root')) {
    options.forceRoot = true;
  }
  
  const convertToRoot = args.includes('--convert-to-root');

  const installer = new RhelInstaller(options);

  try {
    switch (command) {
      case 'install-rhel':
        if (convertToRoot) {
          await installer.convertToRoot();
        } else {
          await installer.install();
        }
        break;
      case 'test-install':
        await installer.testInstall();
        break;
      case 'uninstall-rhel':
        await installer.uninstall();
        break;
      default:
        console.log('Usage: dicomweb-proxy-linux [install-rhel|test-install|uninstall-rhel] [options]');
        console.log('');
        console.log('Commands:');
        console.log('  install-rhel      Install and configure the service');
        console.log('  test-install      Test the current installation');
        console.log('  uninstall-rhel    Remove the service');
        console.log('');
        console.log('Options:');
        console.log('  --root            Run service as root for maximum compatibility');
        console.log('  --convert-to-root Convert existing service to run as root');
        console.log('');
        console.log('Examples:');
        console.log('  sudo dicomweb-proxy-linux install-rhel                    # Standard installation');
        console.log('  sudo dicomweb-proxy-linux install-rhel --root             # Install with root privileges');
        console.log('  sudo dicomweb-proxy-linux install-rhel --convert-to-root  # Convert existing to root');
        console.log('  sudo dicomweb-proxy-linux test-install                    # Test current installation');
        process.exit(1);
    }
  } catch (error) {
    Logger.error(`Installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    process.exit(1);
  }
}