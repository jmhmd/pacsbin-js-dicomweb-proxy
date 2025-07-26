#!/bin/bash

# DICOM Web Proxy RHEL Setup Script
# This script sets up the dicomweb-proxy service on Red Hat Enterprise Linux

set -e

# Configuration
SERVICE_NAME="dicomweb-proxy"
SERVICE_USER="dicomweb"
SERVICE_GROUP="dicomweb"
INSTALL_DIR="/opt/dicomweb-proxy"
BINARY_NAME="dicomweb-proxy-linux"
CONFIG_DIR="$INSTALL_DIR/config"
DATA_DIR="$INSTALL_DIR/data"
LOGS_DIR="$INSTALL_DIR/logs"
CERTS_DIR="$INSTALL_DIR/certs"
SYSTEMD_DIR="/etc/systemd/system"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check if RHEL/CentOS/Fedora
check_rhel() {
    if [[ ! -f /etc/redhat-release ]]; then
        log_error "This script is designed for Red Hat Enterprise Linux, CentOS, or Fedora"
        exit 1
    fi
    
    local os_info=$(cat /etc/redhat-release)
    log_info "Detected OS: $os_info"
}

# Install required packages
install_dependencies() {
    log_info "Installing required packages..."
    
    # Update package lists
    if command -v dnf &> /dev/null; then
        dnf update -y
        dnf install -y firewalld policycoreutils-python-utils
    elif command -v yum &> /dev/null; then
        yum update -y
        yum install -y firewalld policycoreutils-python-utils
    else
        log_error "Neither dnf nor yum package manager found"
        exit 1
    fi
    
    log_success "Dependencies installed"
}

# Create service user
create_user() {
    log_info "Creating service user and group..."
    
    if ! getent group "$SERVICE_GROUP" > /dev/null 2>&1; then
        groupadd --system "$SERVICE_GROUP"
        log_success "Created group: $SERVICE_GROUP"
    else
        log_info "Group $SERVICE_GROUP already exists"
    fi
    
    if ! getent passwd "$SERVICE_USER" > /dev/null 2>&1; then
        useradd --system --gid "$SERVICE_GROUP" --shell /bin/false \
                --home-dir "$INSTALL_DIR" --no-create-home \
                --comment "DICOM Web Proxy Service" "$SERVICE_USER"
        log_success "Created user: $SERVICE_USER"
    else
        log_info "User $SERVICE_USER already exists"
    fi
}

# Create directories
create_directories() {
    log_info "Creating application directories..."
    
    mkdir -p "$INSTALL_DIR"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$DATA_DIR"
    mkdir -p "$LOGS_DIR"
    mkdir -p "$CERTS_DIR"
    
    # Set ownership and permissions
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 750 "$DATA_DIR"
    chmod 750 "$LOGS_DIR"
    chmod 750 "$CERTS_DIR"
    
    log_success "Directories created and configured"
}

# Install binary and configuration
install_application() {
    log_info "Installing application files..."
    
    # Check if binary exists in current directory
    if [[ ! -f "./$BINARY_NAME" ]]; then
        log_error "Binary $BINARY_NAME not found in current directory"
        log_info "Please ensure you have built the RHEL binary using: node build.js --rhel"
        exit 1
    fi
    
    # Stop service if running before upgrading binary
    local was_running=false
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Stopping service for binary upgrade..."
        systemctl stop "$SERVICE_NAME"
        was_running=true
    fi
    
    # Backup existing binary if it exists
    if [[ -f "$INSTALL_DIR/$BINARY_NAME" ]]; then
        cp "$INSTALL_DIR/$BINARY_NAME" "$INSTALL_DIR/${BINARY_NAME}.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "Existing binary backed up"
    fi
    
    # Copy binary
    cp "./$BINARY_NAME" "$INSTALL_DIR/"
    chmod 755 "$INSTALL_DIR/$BINARY_NAME"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/$BINARY_NAME"
    
    # Copy configuration files if they exist
    if [[ -d "./config" ]]; then
        # Backup existing config if it exists
        if [[ -f "$CONFIG_DIR/config.jsonc" ]]; then
            cp "$CONFIG_DIR/config.jsonc" "$CONFIG_DIR/config.jsonc.backup.$(date +%Y%m%d_%H%M%S)"
            log_info "Existing configuration backed up"
        fi
        cp -r ./config/* "$CONFIG_DIR/"
        chown -R "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR"
        chmod 644 "$CONFIG_DIR"/*
        log_success "Configuration files copied"
    else
        log_warn "No config directory found, you'll need to create configuration manually"
    fi
    
    # Restart service if it was running
    if [[ "$was_running" == "true" ]]; then
        log_info "Restarting service..."
        systemctl start "$SERVICE_NAME"
        log_success "Service restarted"
    fi
    
    log_success "Application files installed"
}

# Install systemd service
install_service() {
    log_info "Installing systemd service..."
    
    if [[ ! -f "./dicomweb-proxy.service" ]]; then
        log_error "Service file dicomweb-proxy.service not found in current directory"
        exit 1
    fi
    
    # Copy service file
    cp "./dicomweb-proxy.service" "$SYSTEMD_DIR/"
    chmod 644 "$SYSTEMD_DIR/dicomweb-proxy.service"

    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    
    log_success "Systemd service installed and enabled"
}

# Parse configuration to get ports
get_config_ports() {
    local config_file="$CONFIG_DIR/config.jsonc"
    local http_port=3006
    local ssl_port=443
    local dimse_port=8888
    
    if [[ -f "$config_file" ]]; then
        # Try to parse JSONC for port numbers
        if command -v python3 &> /dev/null; then
            http_port=$(python3 -c "
import json, sys, re
try:
    with open('$config_file') as f:
        content = f.read()
    # Remove comments and trailing commas to make it valid JSON
    content = re.sub(r'//.*', '', content)
    content = re.sub(r',(\s*[}\]])', r'\1', content)
    config = json.loads(content)
    print(config.get('webserverPort', 3006))
except:
    print(3006)
" 2>/dev/null || echo 3006)
            
            ssl_port=$(python3 -c "
import json, sys, re
try:
    with open('$config_file') as f:
        content = f.read()
    content = re.sub(r'//.*', '', content)
    content = re.sub(r',(\s*[}\]])', r'\1', content)
    config = json.loads(content)
    ssl = config.get('ssl', {})
    print(ssl.get('port', 443))
except:
    print(443)
" 2>/dev/null || echo 443)
            
            dimse_port=$(python3 -c "
import json, sys, re
try:
    with open('$config_file') as f:
        content = f.read()
    content = re.sub(r'//.*', '', content)
    content = re.sub(r',(\s*[}\]])', r'\1', content)
    config = json.loads(content)
    dimse = config.get('dimseProxySettings', {})
    proxy = dimse.get('proxyServer', {})
    print(proxy.get('port', 8888))
except:
    print(8888)
" 2>/dev/null || echo 8888)
        fi
    fi
    
    echo "$http_port $ssl_port $dimse_port"
}

# Configure firewall
configure_firewall() {
    log_info "Configuring firewall..."
    
    # Start firewalld if not running
    if ! systemctl is-active --quiet firewalld; then
        systemctl start firewalld
        systemctl enable firewalld
    fi
    
    # Get ports from configuration
    local ports=($(get_config_ports))
    local http_port=${ports[0]}
    local ssl_port=${ports[1]}
    local dimse_port=${ports[2]}
    
    # Remove old proxy-related rules (if any)
    firewall-cmd --permanent --remove-port=3006/tcp 2>/dev/null || true
    firewall-cmd --permanent --remove-port=443/tcp 2>/dev/null || true
    firewall-cmd --permanent --remove-port=8888/tcp 2>/dev/null || true
    
    # Add current configuration ports
    firewall-cmd --permanent --add-port=${http_port}/tcp
    firewall-cmd --permanent --add-port=${ssl_port}/tcp
    firewall-cmd --permanent --add-port=${dimse_port}/tcp
    firewall-cmd --reload
    
    log_success "Firewall configured (ports $http_port, $ssl_port, and $dimse_port opened)"
}

# Configure SELinux
configure_selinux() {
    log_info "Configuring SELinux..."
    
    if command -v getenforce &> /dev/null && [[ $(getenforce) != "Disabled" ]]; then
        # Set SELinux context for the binary
        if command -v setsebool &> /dev/null; then
            setsebool -P httpd_can_network_connect 1
        fi
        
        # Set file contexts
        if command -v semanage &> /dev/null; then
            semanage fcontext -a -t bin_t "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || true
            restorecon -v "$INSTALL_DIR/$BINARY_NAME"
        fi
        
        log_success "SELinux configured"
    else
        log_info "SELinux is disabled, skipping SELinux configuration"
    fi
}

# Create example configuration
create_example_config() {
    local config_file="$CONFIG_DIR/config.jsonc"
    
    if [[ ! -f "$config_file" ]]; then
        log_info "Creating example configuration..."
        
        # First, check if a config.jsonc exists (user's preferred config)
        if [[ -f "$CONFIG_DIR/config.jsonc" ]]; then
            log_info "Using existing config.jsonc"
        # Otherwise, check if example-config.jsonc exists and use it as template
        elif [[ -f "$CONFIG_DIR/example-config.jsonc" ]]; then
            log_info "Using example-config.jsonc as template"
            cp "$CONFIG_DIR/example-config.jsonc" "$config_file"
            
            # Update paths for RHEL installation
            sed -i 's|"./logs"|"/opt/dicomweb-proxy/logs"|g' "$config_file"
            sed -i 's|"./data"|"/opt/dicomweb-proxy/data"|g' "$config_file"
            sed -i 's|"./certs/server.crt"|"/opt/dicomweb-proxy/certs/server.crt"|g' "$config_file"
            sed -i 's|"./certs/server.key"|"/opt/dicomweb-proxy/certs/server.key"|g' "$config_file"
        else
            log_warn "No example config found, creating basic configuration"
            # Fallback minimal config if no example exists
            cat > "$config_file" << 'EOF'
{
  // Options are "dimse" or "dicomweb"
  "proxyMode": "dimse",

  // If the proxyMode is "dicomweb", then we are just forwarding incoming
  // dicomweb requests to another dicomweb server, and attaching the configured
  // CORS headers to the response.
  "dicomwebProxySettings": {
    "qidoForwardingUrl": "https://qido.example.com/qido",
    "wadoForwardingUrl": "https://wado.example.com/wado"
  },

  // If the proxyMode is "dimse", then we are translating incoming dicomweb
  // requests to DIMSE, sending to a peer DIMSE server, translating the response
  // back to dicomweb, and attaching the configured CORS headers to the response.
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
  "logDir": "/opt/dicomweb-proxy/logs",
  "storagePath": "/opt/dicomweb-proxy/data",
  "cacheRetentionMinutes": 60,
  "enableCache": true, // Set to false to disable file caching for testing
  "webserverPort": 3006, // Port to run the web server on that listens for incoming dicomweb requests
  "useCget": false,
  "useFetchLevel": "SERIES",
  "maxAssociations": 4,
  "qidoMinChars": 0,
  "qidoAppendWildcard": true,
  "ssl": {
    "enabled": false,
    "port": 443,
    "certPath": "/opt/dicomweb-proxy/certs/server.crt",
    "keyPath": "/opt/dicomweb-proxy/certs/server.key",
    "generateSelfSigned": false,
    "redirectHttp": true
  },
  "cors": {
    "origin": ["*"],
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allowedHeaders": ["Content-Type", "Authorization", "Accept"],
    "credentials": true
  }
}
EOF
        fi
        
        chown "$SERVICE_USER:$SERVICE_GROUP" "$config_file"
        chmod 644 "$config_file"
        
        log_success "Configuration created at $config_file"
        log_warn "Please review and modify the configuration before starting the service"
    fi
}

# Display service management commands
show_usage() {
    log_success "Installation completed!"
    echo ""
    echo "Service Management Commands:"
    echo "  Start service:    sudo systemctl start $SERVICE_NAME"
    echo "  Stop service:     sudo systemctl stop $SERVICE_NAME"
    echo "  Restart service:  sudo systemctl restart $SERVICE_NAME"
    echo "  Check status:     sudo systemctl status $SERVICE_NAME"
    echo "  View logs:        sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "Configuration:"
    echo "  Config file:      $CONFIG_DIR/config.jsonc"
    echo "  Data directory:   $DATA_DIR"
    echo "  Logs directory:   $LOGS_DIR"
    echo ""
    echo "Next Steps:"
    echo "  1. Review and modify the configuration file"
    echo "  2. Start the service: sudo systemctl start $SERVICE_NAME"
    echo "  3. Check the service status and logs"
}

# Main installation function
main() {
    log_info "Starting DICOM Web Proxy installation for RHEL..."
    
    check_root
    check_rhel
    install_dependencies
    create_user
    create_directories
    install_application
    install_service
    configure_firewall
    configure_selinux
    create_example_config
    show_usage
}

# Upgrade function for re-running with new binary or config
upgrade() {
    log_info "Upgrading DICOM Web Proxy..."
    
    check_root
    
    # Only install application files and update firewall
    install_application
    configure_firewall
    
    log_success "Upgrade completed!"
    log_info "Service will use the new binary and configuration"
    echo ""
    echo "To apply changes, restart the service:"
    echo "  sudo systemctl restart $SERVICE_NAME"
}

# Update configuration function
update_config() {
    log_info "Updating configuration and firewall rules..."
    
    check_root
    
    # Only update firewall rules based on current config
    configure_firewall
    
    log_success "Configuration update completed!"
    log_info "Restart the service to apply configuration changes:"
    echo "  sudo systemctl restart $SERVICE_NAME"
}

# Handle script arguments
case "${1:-install}" in
    install)
        main
        ;;
    upgrade)
        upgrade
        ;;
    update-config)
        update_config
        ;;
    uninstall)
        log_info "Uninstalling DICOM Web Proxy..."
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        rm -f "$SYSTEMD_DIR/dicomweb-proxy.service"
        systemctl daemon-reload
        
        # Remove firewall rules
        firewall-cmd --permanent --remove-port=3006/tcp 2>/dev/null || true
        firewall-cmd --permanent --remove-port=443/tcp 2>/dev/null || true
        firewall-cmd --permanent --remove-port=8888/tcp 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        
        userdel "$SERVICE_USER" 2>/dev/null || true
        groupdel "$SERVICE_GROUP" 2>/dev/null || true
        rm -rf "$INSTALL_DIR"
        log_success "Uninstallation completed"
        ;;
    *)
        echo "Usage: $0 [install|upgrade|update-config|uninstall]"
        echo "  install       - Install and configure the service (default)"
        echo "  upgrade       - Upgrade binary and configuration files"
        echo "  update-config - Update firewall rules based on current configuration"
        echo "  uninstall     - Remove the service and all files"
        exit 1
        ;;
esac