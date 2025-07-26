# RHEL Deployment Guide

This directory contains files for deploying the DICOM Web Proxy on Red Hat Enterprise Linux (RHEL), CentOS, or Fedora systems.

## Files

- `setup-rhel.sh` - Automated installation script
- `dicomweb-proxy.service` - Systemd service configuration
- `README.md` - This file

## Quick Start

### 1. Build for RHEL

On your development machine, create a Linux-compatible binary:

```bash
# Build for RHEL/Linux
node build.js --rhel [--deno || --bun || --node]
```

This creates `build/dicomweb-proxy-linux` binary that can run on RHEL systems.

### 2. Transfer Files

Copy the following files to your RHEL server:

```bash
# Required files:
- build/rhel/dicomweb-proxy-linux
- build/rhel/setup-rhel.sh  
- build/rhel/dicomweb-proxy.service
- config/ (optional, example config will be created)
```

### 3. Install on RHEL

On the RHEL server, run the setup script as root:

```bash
# Make script executable
chmod +x setup-rhel.sh

# Run installation
sudo ./setup-rhel.sh
```

### 4. Configure and Start

```bash
# Edit configuration
sudo nano /opt/dicomweb-proxy/config/config.json

# Start the service
sudo systemctl start dicomweb-proxy

# Check status
sudo systemctl status dicomweb-proxy
```

## What the Setup Script Does

### System Configuration
- Creates `dicomweb` user and group for security
- Installs to `/opt/dicomweb-proxy/`
- Sets up proper file permissions and ownership
- Configures SELinux contexts (if enabled)

### Service Management
- Installs systemd service for auto-start/restart
- Enables service to start on boot
- Configures service isolation and security settings

### Network Configuration
- Opens firewall ports (3006 for HTTP, 8888 for DIMSE)
- Configures basic firewall rules

### Directory Structure
```
/opt/dicomweb-proxy/
├── dicomweb-proxy-linux    # Main binary
├── config/
│   └── config.json         # Configuration file
├── data/                   # Cache and storage
├── logs/                   # Application logs
└── certs/                  # SSL certificates (if using HTTPS)
```

## Service Management

```bash
# Start service
sudo systemctl start dicomweb-proxy

# Stop service  
sudo systemctl stop dicomweb-proxy

# Restart service
sudo systemctl restart dicomweb-proxy

# Enable auto-start on boot
sudo systemctl enable dicomweb-proxy

# Check service status
sudo systemctl status dicomweb-proxy

# View live logs
sudo journalctl -u dicomweb-proxy -f

# View recent logs
sudo journalctl -u dicomweb-proxy --since "1 hour ago"
```

## Configuration

The service looks for configuration at `/opt/dicomweb-proxy/config/config.json`.

Key settings to review:
- **DIMSE peers**: Update IP addresses and AET titles for your PACS servers
- **Ports**: Ensure firewall allows the configured ports
- **Storage paths**: Verify the service user has write access
- **SSL settings**: Configure certificates if using HTTPS (must use absolute paths)

Example minimal configuration:
```json
{
  "proxyMode": "dimse",
  "dimseProxySettings": {
    "proxyServer": {
      "aet": "PROXY_AET",
      "ip": "0.0.0.0", 
      "port": 8888
    },
    "peers": [
      {
        "aet": "PACS_AET",
        "ip": "192.168.1.100",
        "port": 11112
      }
    ]
  },
  "webserverPort": 3006,
  "logDir": "/opt/dicomweb-proxy/logs",
  "storagePath": "/opt/dicomweb-proxy/data"
}
```

## Security Features

The systemd service includes security hardening:
- Runs as non-privileged `dicomweb` user
- Restricted file system access
- Private `/tmp` directory
- No new privileges allowed
- Protected system directories

## Firewall Configuration

Default ports opened:
- **3006/tcp** - HTTP API (configurable)
- **8888/tcp** - DIMSE proxy port (configurable)

Modify firewall rules if using different ports:
```bash
# Remove old rule
sudo firewall-cmd --permanent --remove-port=3006/tcp

# Add new rule  
sudo firewall-cmd --permanent --add-port=8080/tcp

# Reload firewall
sudo firewall-cmd --reload
```

## Troubleshooting

### Service Won't Start
```bash
# Check service status
sudo systemctl status dicomweb-proxy

# Check logs for errors
sudo journalctl -u dicomweb-proxy --since "10 minutes ago"

# Verify configuration
sudo -u dicomweb /opt/dicomweb-proxy/dicomweb-proxy-linux --validate-config /opt/dicomweb-proxy/config/config.json
```

### Permission Issues
```bash
# Fix ownership
sudo chown -R dicomweb:dicomweb /opt/dicomweb-proxy

# Fix permissions
sudo chmod 755 /opt/dicomweb-proxy/dicomweb-proxy-linux
sudo chmod 750 /opt/dicomweb-proxy/data
sudo chmod 750 /opt/dicomweb-proxy/logs
```

### Network Issues
```bash
# Check if ports are listening
sudo netstat -tlnp | grep -E "(3006|8888)"

# Test firewall rules
sudo firewall-cmd --list-ports

# Check SELinux denials (if enabled)
sudo ausearch -m avc -ts recent
```

## Uninstallation

To completely remove the service:

```bash
sudo ./setup-rhel.sh uninstall
```

This removes:
- The systemd service
- The `dicomweb` user and group  
- All files in `/opt/dicomweb-proxy/`

## Support

For issues specific to RHEL deployment, check:
1. Service logs: `sudo journalctl -u dicomweb-proxy -f`
2. System logs: `sudo journalctl --since "1 hour ago"`
3. SELinux logs: `sudo ausearch -m avc -ts recent`
4. Firewall status: `sudo firewall-cmd --list-all`