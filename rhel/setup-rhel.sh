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
# CERTS_DIR removed - certificate paths are now dynamic based on config
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
        dnf install -y firewalld policycoreutils-python-utils libcap
    elif command -v yum &> /dev/null; then
        yum update -y
        yum install -y firewalld policycoreutils-python-utils libcap
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
# Certificate directories are created dynamically by install_certificates()
    
    # Set ownership and permissions
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 750 "$DATA_DIR"
    chmod 750 "$LOGS_DIR"
# Certificate directory permissions set by install_certificates()
    
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
    
    # Set capabilities to allow binding to privileged ports (< 1024) without root
    if command -v setcap &> /dev/null; then
        setcap cap_net_bind_service=+ep "$INSTALL_DIR/$BINARY_NAME"
        log_success "Set port binding capabilities on binary"
    else
        log_warn "setcap not found - install libcap-devel or run service as root for privileged ports"
    fi
    
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
# Parse configuration to get all SSL/cert info including paths
get_config_info() {
    local config_file="$CONFIG_DIR/config.jsonc"
    local http_port=3006
    local ssl_port=443
    local dimse_port=8888
    local cert_path="/opt/dicomweb-proxy/certs/server.crt"
    local key_path="/opt/dicomweb-proxy/certs/server.key"
    local ssl_enabled="false"
    
    if [[ -f "$config_file" ]]; then
        # Try to parse JSONC for configuration values
        if command -v python3 &> /dev/null; then
            local parsed_config=$(python3 -c "
import json, sys, re
try:
    with open('$config_file') as f:
        content = f.read()
    # Remove comments and trailing commas to make it valid JSON
    content = re.sub(r'//.*', '', content)
    content = re.sub(r',(\s*[}\]])', r'\1', content)
    config = json.loads(content)
    
    # Get ports
    http_port = config.get('webserverPort', 3006)
    ssl = config.get('ssl', {})
    ssl_port = ssl.get('port', 443)
    ssl_enabled = str(ssl.get('enabled', False)).lower()
    cert_path = ssl.get('certPath', '/opt/dicomweb-proxy/certs/server.crt')
    key_path = ssl.get('keyPath', '/opt/dicomweb-proxy/certs/server.key')
    
    dimse = config.get('dimseProxySettings', {})
    proxy = dimse.get('proxyServer', {})
    dimse_port = proxy.get('port', 8888)
    
    print(f'{http_port} {ssl_port} {dimse_port} {cert_path} {key_path} {ssl_enabled}')
except Exception as e:
    print('3006 443 8888 /opt/dicomweb-proxy/certs/server.crt /opt/dicomweb-proxy/certs/server.key false')
" 2>/dev/null)
            
            if [[ -n "$parsed_config" ]]; then
                echo "$parsed_config"
            else
                echo "$http_port $ssl_port $dimse_port $cert_path $key_path $ssl_enabled"
            fi
        else
            echo "$http_port $ssl_port $dimse_port $cert_path $key_path $ssl_enabled"
        fi
    else
        echo "$http_port $ssl_port $dimse_port $cert_path $key_path $ssl_enabled"
    fi
}

get_config_ports() {
    local info=($(get_config_info))
    echo "${info[0]} ${info[1]} ${info[2]}"
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

# Install and configure SSL certificates based on config paths
install_certificates() {
    log_info "Configuring SSL certificates..."
    
    # Get certificate paths from config
    local config_info=($(get_config_info))
    local cert_path="${config_info[3]}"
    local key_path="${config_info[4]}"
    local ssl_enabled="${config_info[5]}"
    
    if [[ "$ssl_enabled" != "true" ]]; then
        log_info "SSL is disabled in config, skipping certificate setup"
        return 0
    fi
    
    log_info "SSL enabled - configuring certificates:"
    log_info "  Certificate: $cert_path"
    log_info "  Key: $key_path"
    
    # Create certificate directory if it doesn't exist
    local cert_dir=$(dirname "$cert_path")
    local key_dir=$(dirname "$key_path")
    
    if [[ "$cert_dir" != "$key_dir" ]]; then
        log_warn "Certificate and key are in different directories: $cert_dir vs $key_dir"
    fi
    
    # Create directories
    mkdir -p "$cert_dir"
    mkdir -p "$key_dir"
    
    # Check if certificates already exist at the configured paths
    if [[ -f "$cert_path" && -f "$key_path" ]]; then
        log_info "Certificates already exist at configured paths"
        
        # Set proper ownership and permissions
        chown "$SERVICE_USER:$SERVICE_GROUP" "$cert_path" "$key_path"
        chmod 644 "$cert_path"
        chmod 600 "$key_path"
        
        # Set SELinux contexts
        if command -v getenforce &> /dev/null && [[ $(getenforce) != "Disabled" ]]; then
            if command -v semanage &> /dev/null; then
                semanage fcontext -a -t cert_t "$cert_path" 2>/dev/null || true
                semanage fcontext -a -t cert_t "$key_path" 2>/dev/null || true
                restorecon -v "$cert_path" "$key_path" 2>/dev/null || true
            fi
        fi
        
        log_success "Existing certificates configured"
        
    else
        # Look for certificates in common locations to copy
        local found_certs=false
        local search_paths=(
            "/opt/certs"
            "/etc/ssl/certs"
            "/etc/pki/tls/certs"
            "./certs"
            "$(pwd)/certs"
        )
        
        for search_path in "${search_paths[@]}"; do
            if [[ -f "$search_path/server.crt" && -f "$search_path/server.key" ]]; then
                log_info "Found certificates in $search_path, copying to configured location"
                
                cp "$search_path/server.crt" "$cert_path"
                cp "$search_path/server.key" "$key_path"
                
                # Set proper ownership and permissions
                chown "$SERVICE_USER:$SERVICE_GROUP" "$cert_path" "$key_path"
                chmod 644 "$cert_path"
                chmod 600 "$key_path"
                
                # Set SELinux contexts
                if command -v getenforce &> /dev/null && [[ $(getenforce) != "Disabled" ]]; then
                    if command -v semanage &> /dev/null; then
                        semanage fcontext -a -t cert_t "$cert_path" 2>/dev/null || true
                        semanage fcontext -a -t cert_t "$key_path" 2>/dev/null || true
                        restorecon -v "$cert_path" "$key_path" 2>/dev/null || true
                    fi
                fi
                
                found_certs=true
                log_success "Certificates copied and configured"
                break
            fi
        done
        
        if [[ "$found_certs" != "true" ]]; then
            log_warn "No SSL certificates found in common locations"
            log_warn "Please place your SSL certificates at:"
            log_warn "  Certificate: $cert_path"
            log_warn "  Key: $key_path"
            log_warn "Or disable SSL in the configuration"
            
            # Create the directories with proper ownership for manual cert placement
            chown "$SERVICE_USER:$SERVICE_GROUP" "$cert_dir" "$key_dir"
            chmod 750 "$cert_dir" "$key_dir"
        fi
    fi
}

# Configure SELinux
configure_selinux() {
    log_info "Configuring SELinux..."
    
    if command -v getenforce &> /dev/null && [[ $(getenforce) != "Disabled" ]]; then
        # Get configuration info including certificate paths
        local config_info=($(get_config_info))
        local http_port=${config_info[0]}
        local ssl_port=${config_info[1]}
        local dimse_port=${config_info[2]}
        local cert_path="${config_info[3]}"
        local key_path="${config_info[4]}"
        local ssl_enabled="${config_info[5]}"
        
        # Set SELinux boolean to allow network connections
        if command -v setsebool &> /dev/null; then
            setsebool -P httpd_can_network_connect 1
        fi
        
        # Allow binding to ports
        if command -v semanage &> /dev/null; then
            # Allow HTTP port
            semanage port -a -t http_port_t -p tcp $http_port 2>/dev/null || \
            semanage port -m -t http_port_t -p tcp $http_port 2>/dev/null || true
            
            # Allow SSL port (443 is usually already defined)
            semanage port -a -t http_port_t -p tcp $ssl_port 2>/dev/null || \
            semanage port -m -t http_port_t -p tcp $ssl_port 2>/dev/null || true
            
            # Allow DIMSE port
            semanage port -a -t http_port_t -p tcp $dimse_port 2>/dev/null || \
            semanage port -m -t http_port_t -p tcp $dimse_port 2>/dev/null || true
        fi
        
        # Set file contexts for the binary
        if command -v semanage &> /dev/null; then
            semanage fcontext -a -t bin_t "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || true
            restorecon -v "$INSTALL_DIR/$BINARY_NAME"
        fi
        
        # Configure SELinux contexts for SSL certificates if they exist
        if [[ "$ssl_enabled" == "true" && -f "$cert_path" && -f "$key_path" ]]; then
            if command -v semanage &> /dev/null; then
                # Set proper context for certificate files
                local cert_dir=$(dirname "$cert_path")
                local key_dir=$(dirname "$key_path")
                
                # Set context for certificate directory and files
                semanage fcontext -a -t cert_t "$cert_dir(/.*)?" 2>/dev/null || true
                if [[ "$cert_dir" != "$key_dir" ]]; then
                    semanage fcontext -a -t cert_t "$key_dir(/.*)?" 2>/dev/null || true
                fi
                
                # Apply contexts
                restorecon -Rv "$cert_dir" 2>/dev/null || true
                if [[ "$cert_dir" != "$key_dir" ]]; then
                    restorecon -Rv "$key_dir" 2>/dev/null || true
                fi
                
                log_info "SELinux contexts configured for certificates at $cert_path and $key_path"
            fi
        fi
        
        log_success "SELinux configured for ports $http_port, $ssl_port, and $dimse_port"
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
    echo ""
    echo "Port Binding Notes:"
    echo "  - Binary has been configured with capabilities to bind to privileged ports"
    echo "  - SELinux has been configured to allow port binding"
    
    # Show SSL-specific troubleshooting if SSL is enabled
    local config_info=($(get_config_info))
    local cert_path="${config_info[3]}"
    local key_path="${config_info[4]}"
    local ssl_enabled="${config_info[5]}"
    
    if [[ "$ssl_enabled" == "true" ]]; then
        echo "  - SSL is enabled. If SSL still fails, verify certificate file permissions:"
        echo "    sudo chmod 644 $cert_path"
        echo "    sudo chmod 600 $key_path"
        echo "    sudo chown $SERVICE_USER:$SERVICE_GROUP $cert_path $key_path"
        echo "    sudo restorecon -v $cert_path $key_path"
    else
        echo "  - SSL is disabled in configuration"
    fi
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
    create_example_config
    install_certificates
    configure_firewall
    configure_selinux
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