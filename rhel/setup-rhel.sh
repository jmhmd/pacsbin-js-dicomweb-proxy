#!/bin/bash

# DICOM Web Proxy RHEL Setup Script - Improved Version
# Priority: Reliability over security - ensure the service runs
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

# Option to run as root for maximum reliability (set via environment or flag)
RUN_AS_ROOT="${RUN_AS_ROOT:-false}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Logging functions with more detail
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

log_detail() {
    echo -e "${MAGENTA}[DETAIL]${NC} $1"
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
    
    # Determine package manager
    local pkg_manager=""
    if command -v dnf &> /dev/null; then
        pkg_manager="dnf"
    elif command -v yum &> /dev/null; then
        pkg_manager="yum"
    else
        log_error "Neither dnf nor yum package manager found"
        exit 1
    fi
    
    log_detail "Using package manager: $pkg_manager"
    
    # Update package lists
    $pkg_manager update -y
    
    # Install required packages
    $pkg_manager install -y \
        firewalld \
        policycoreutils-python-utils \
        libcap \
        python3 \
        jq || {
        log_warn "Some packages failed to install, continuing anyway..."
    }
    
    log_success "Dependencies installed"
}

# Create service user (or configure for root)
create_user() {
    if [[ "$RUN_AS_ROOT" == "true" ]]; then
        log_warn "Service will run as root (maximum compatibility mode)"
        SERVICE_USER="root"
        SERVICE_GROUP="root"
        return
    fi
    
    log_info "Creating service user and group..."
    
    if ! getent group "$SERVICE_GROUP" > /dev/null 2>&1; then
        groupadd --system "$SERVICE_GROUP"
        log_success "Created group: $SERVICE_GROUP"
    else
        log_detail "Group $SERVICE_GROUP already exists"
    fi
    
    if ! getent passwd "$SERVICE_USER" > /dev/null 2>&1; then
        useradd --system --gid "$SERVICE_GROUP" --shell /bin/false \
                --home-dir "$INSTALL_DIR" --no-create-home \
                --comment "DICOM Web Proxy Service" "$SERVICE_USER"
        log_success "Created user: $SERVICE_USER"
    else
        log_detail "User $SERVICE_USER already exists"
    fi
}

# Create directories with explicit permission logging
create_directories() {
    log_info "Creating application directories..."
    
    for dir in "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOGS_DIR" "$CERTS_DIR"; do
        mkdir -p "$dir"
        log_detail "Created/verified directory: $dir"
    done
    
    # Set ownership and permissions with logging
    log_info "Setting directory permissions..."
    
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    chmod 755 "$INSTALL_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 750 "$DATA_DIR"
    chmod 750 "$LOGS_DIR"
    chmod 750 "$CERTS_DIR"
    
    log_detail "Owner set to: $SERVICE_USER:$SERVICE_GROUP"
    log_detail "Permissions: INSTALL_DIR=755, CONFIG_DIR=755, DATA_DIR=750, LOGS_DIR=750, CERTS_DIR=750"
    
    log_success "Directories created and configured"
}

# Simple and reliable JSONC parser
parse_jsonc_value() {
    local config_file="$1"
    local key_path="$2"
    
    python3 -c "
import json, sys, re

def parse_jsonc(filename):
    try:
        with open(filename, 'r') as f:
            content = f.read()
        
        # Remove single-line comments more carefully
        lines = content.split('\n')
        cleaned_lines = []
        
        for line in lines:
            # Track if we're inside a string
            in_string = False
            escaped = False
            result = []
            
            for i, char in enumerate(line):
                if escaped:
                    result.append(char)
                    escaped = False
                    continue
                    
                if char == '\\\\' and in_string:
                    escaped = True
                    result.append(char)
                    continue
                    
                if char == '\"' and not escaped:
                    in_string = not in_string
                    result.append(char)
                    continue
                
                # Check for comment start only outside strings
                if not in_string and char == '/' and i + 1 < len(line) and line[i + 1] == '/':
                    break  # Rest of line is comment
                    
                result.append(char)
            
            cleaned_lines.append(''.join(result))
        
        content = '\n'.join(cleaned_lines)
        
        # Remove multi-line comments
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        
        # Remove trailing commas
        content = re.sub(r',\s*([}\]])', r'\1', content)
        
        return json.loads(content)
    except Exception as e:
        print('', end='')
        sys.exit(1)

try:
    config = parse_jsonc('$config_file')
    
    # Navigate to the value using the key path
    keys = '$key_path'.split('.')
    value = config
    
    for key in keys:
        if key:
            if isinstance(value, dict):
                value = value.get(key)
            else:
                value = None
                break
    
    if isinstance(value, bool):
        print(str(value).lower())
    elif value is None:
        print('')
    else:
        print(value)
        
except:
    print('')
" 2>/dev/null || echo ""
}

# Validate and get configuration with detailed logging
validate_and_get_config() {
    local config_file="$1"
    
    log_info "Validating configuration file: $config_file"
    
    if [[ ! -f "$config_file" ]]; then
        log_error "Configuration file not found: $config_file"
        return 1
    fi
    
    # Parse configuration values using simple dot notation
    local proxy_mode=$(parse_jsonc_value "$config_file" "proxyMode")
    local http_port=$(parse_jsonc_value "$config_file" "webserverPort")
    local ssl_enabled=$(parse_jsonc_value "$config_file" "ssl.enabled")
    local ssl_port=$(parse_jsonc_value "$config_file" "ssl.port")
    local cert_path=$(parse_jsonc_value "$config_file" "ssl.certPath")
    local key_path=$(parse_jsonc_value "$config_file" "ssl.keyPath")
    local dimse_port=$(parse_jsonc_value "$config_file" "dimseProxySettings.proxyServer.port")
    
    # Set defaults if values are empty
    [[ -z "$http_port" ]] && http_port="3006"
    [[ -z "$ssl_port" ]] && ssl_port="443"
    [[ -z "$ssl_enabled" ]] && ssl_enabled="false"
    [[ -z "$dimse_port" ]] && dimse_port="8888"
    
    # Log all extracted values for transparency
    log_detail "Configuration values extracted:"
    log_detail "  Proxy Mode: $proxy_mode"
    log_detail "  HTTP Port: $http_port"
    log_detail "  SSL Enabled: $ssl_enabled"
    log_detail "  SSL Port: $ssl_port"
    log_detail "  Certificate Path (from config): $cert_path"
    log_detail "  Key Path (from config): $key_path"
    log_detail "  DIMSE Port: $dimse_port"
    
    # Validate required fields
    if [[ -z "$proxy_mode" ]]; then
        log_error "Missing required field: proxyMode"
        return 1
    fi
    
    if [[ "$proxy_mode" != "dimse" && "$proxy_mode" != "dicomweb" ]]; then
        log_error "Invalid proxyMode: $proxy_mode (must be 'dimse' or 'dicomweb')"
        return 1
    fi
    
    # Export values for use by caller
    export CONFIG_PROXY_MODE="$proxy_mode"
    export CONFIG_HTTP_PORT="$http_port"
    export CONFIG_SSL_ENABLED="$ssl_enabled"
    export CONFIG_SSL_PORT="$ssl_port"
    export CONFIG_CERT_PATH="$cert_path"
    export CONFIG_KEY_PATH="$key_path"
    export CONFIG_DIMSE_PORT="$dimse_port"
    
    log_success "Configuration validated successfully"
    return 0
}

# Install binary and configuration with detailed logging
install_application() {
    log_info "Installing application files..."
    
    # Check if binary exists
    if [[ ! -f "./$BINARY_NAME" ]]; then
        log_error "Binary $BINARY_NAME not found in current directory"
        log_error "Current directory: $(pwd)"
        log_error "Files in current directory:"
        ls -la
        exit 1
    fi
    
    log_detail "Found binary: $(pwd)/$BINARY_NAME"
    
    # Stop service if running
    local was_running=false
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_info "Stopping service for binary upgrade..."
        systemctl stop "$SERVICE_NAME"
        was_running=true
    fi
    
    # Backup existing binary
    if [[ -f "$INSTALL_DIR/$BINARY_NAME" ]]; then
        local backup_name="$INSTALL_DIR/${BINARY_NAME}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$INSTALL_DIR/$BINARY_NAME" "$backup_name"
        log_detail "Backed up existing binary to: $backup_name"
    fi
    
    # Copy binary
    cp "./$BINARY_NAME" "$INSTALL_DIR/"
    chmod 755 "$INSTALL_DIR/$BINARY_NAME"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR/$BINARY_NAME"
    log_success "Binary installed to: $INSTALL_DIR/$BINARY_NAME"
    log_detail "Binary permissions: 755, owner: $SERVICE_USER:$SERVICE_GROUP"
    
    # Set capabilities for port binding (if not running as root)
    if [[ "$RUN_AS_ROOT" != "true" ]]; then
        if command -v setcap &> /dev/null; then
            setcap cap_net_bind_service=+ep "$INSTALL_DIR/$BINARY_NAME"
            log_success "Set port binding capabilities on binary"
            
            # Verify capabilities were set
            local caps=$(getcap "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || echo "none")
            log_detail "Binary capabilities: $caps"
        else
            log_warn "setcap not available - service may not bind to privileged ports"
            log_warn "Consider setting RUN_AS_ROOT=true for maximum compatibility"
        fi
    fi
    
    # Copy configuration files
    if [[ -d "./config" ]]; then
        # Backup existing config
        if [[ -f "$CONFIG_DIR/config.jsonc" ]]; then
            local backup_name="$CONFIG_DIR/config.jsonc.backup.$(date +%Y%m%d_%H%M%S)"
            cp "$CONFIG_DIR/config.jsonc" "$backup_name"
            log_detail "Backed up existing config to: $backup_name"
        fi
        
        cp -r ./config/* "$CONFIG_DIR/"
        chown -R "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR"
        chmod 644 "$CONFIG_DIR"/*
        log_success "Configuration files copied to: $CONFIG_DIR"
    else
        log_warn "No config directory found in current directory"
    fi
    
    # Restart service if it was running
    if [[ "$was_running" == "true" ]]; then
        log_info "Restarting service..."
        systemctl start "$SERVICE_NAME"
        log_success "Service restarted"
    fi
}

# Install systemd service with root option
install_service() {
    log_info "Installing systemd service..."
    
    local service_file="dicomweb-proxy.service"
    
    if [[ ! -f "./$service_file" ]]; then
        log_warn "Service file not found, creating default service file..."
        
        # Create a default service file
        cat > "$SYSTEMD_DIR/$SERVICE_NAME.service" << EOF
[Unit]
Description=DICOM Web Proxy Service
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BINARY_NAME
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF
        log_success "Created default service file"
    else
        # Copy provided service file
        cp "./$service_file" "$SYSTEMD_DIR/$SERVICE_NAME.service"
        
        # Update User/Group in service file if running as root
        if [[ "$RUN_AS_ROOT" == "true" ]]; then
            sed -i "s/^User=.*/User=root/" "$SYSTEMD_DIR/$SERVICE_NAME.service"
            sed -i "s/^Group=.*/Group=root/" "$SYSTEMD_DIR/$SERVICE_NAME.service"
            log_detail "Updated service file to run as root"
        fi
    fi
    
    chmod 644 "$SYSTEMD_DIR/$SERVICE_NAME.service"
    log_detail "Service file installed: $SYSTEMD_DIR/$SERVICE_NAME.service"
    
    # Show service file contents for verification
    log_detail "Service configuration:"
    grep -E "^(User|Group|ExecStart|WorkingDirectory)=" "$SYSTEMD_DIR/$SERVICE_NAME.service" | while read line; do
        log_detail "  $line"
    done
    
    # Reload systemd
    systemctl daemon-reload
    
    # Enable service
    systemctl enable "$SERVICE_NAME"
    
    log_success "Systemd service installed and enabled"
}

# Simplified certificate installation with clear logging
install_certificates() {
    log_info "Configuring SSL certificates..."
    
    # First, validate configuration to get SSL settings
    local config_file
    if [[ -f "./config/config.jsonc" ]]; then
        config_file="./config/config.jsonc"
    else
        config_file="$CONFIG_DIR/config.jsonc"
    fi
    
    if ! validate_and_get_config "$config_file"; then
        log_error "Failed to read configuration for certificate setup"
        return 1
    fi
    
    if [[ "$CONFIG_SSL_ENABLED" != "true" ]]; then
        log_info "SSL is disabled in configuration - skipping certificate setup"
        return 0
    fi
    
    log_info "SSL is enabled - setting up certificates"
    
    # Define standard paths where the application will look for certificates
    local standard_cert="$CERTS_DIR/server.crt"
    local standard_key="$CERTS_DIR/server.key"
    
    log_detail "Application will look for certificates at:"
    log_detail "  Certificate: $standard_cert"
    log_detail "  Private Key: $standard_key"
    
    # Backup existing certificates
    for file in "$standard_cert" "$standard_key"; do
        if [[ -f "$file" ]]; then
            local backup="$file.backup.$(date +%Y%m%d_%H%M%S)"
            cp "$file" "$backup"
            log_detail "Backed up: $file -> $backup"
        fi
    done
    
    # Check for certificates at the paths specified in the configuration
    log_info "Looking for certificates at config-specified paths..."
    log_detail "  Certificate: $CONFIG_CERT_PATH"
    log_detail "  Private Key: $CONFIG_KEY_PATH"
    
    if [[ -z "$CONFIG_CERT_PATH" || -z "$CONFIG_KEY_PATH" ]]; then
        log_error "SSL is enabled but certificate paths are not specified in configuration"
        log_error "Please set certPath and keyPath in the ssl section of your config.jsonc"
        exit 1
    fi
    
    if [[ ! -f "$CONFIG_CERT_PATH" ]]; then
        log_error "SSL certificate not found at configured path: $CONFIG_CERT_PATH"
        log_error "Please ensure the certificate file exists at this path, or update the certPath in config.jsonc"
        exit 1
    fi
    
    if [[ ! -f "$CONFIG_KEY_PATH" ]]; then
        log_error "SSL private key not found at configured path: $CONFIG_KEY_PATH"
        log_error "Please ensure the private key file exists at this path, or update the keyPath in config.jsonc"
        exit 1
    fi
    
    log_success "Found certificates at configured paths!"
    log_detail "  Certificate: $CONFIG_CERT_PATH"
    log_detail "  Private Key: $CONFIG_KEY_PATH"
    
    # Copy to standard location
    cp "$CONFIG_CERT_PATH" "$standard_cert"
    cp "$CONFIG_KEY_PATH" "$standard_key"
    
    # Set permissions
    chown "$SERVICE_USER:$SERVICE_GROUP" "$standard_cert" "$standard_key"
    chmod 644 "$standard_cert"
    chmod 600 "$standard_key"
    
    log_success "Certificates installed to standard location"
    log_detail "Permissions set: cert=644, key=600, owner=$SERVICE_USER:$SERVICE_GROUP"
    
    # Update configuration to use standard paths
    log_info "Updating configuration to use standard certificate paths..."
    sed -i "s|\"certPath\".*:|\"certPath\": \"$standard_cert\",|g" "$CONFIG_DIR/config.jsonc" 2>/dev/null || true
    sed -i "s|\"keyPath\".*:|\"keyPath\": \"$standard_key\",|g" "$CONFIG_DIR/config.jsonc" 2>/dev/null || true
    log_detail "Configuration updated to use standard paths"
}

# Configure firewall with detailed logging
configure_firewall() {
    log_info "Configuring firewall..."
    
    # Check if firewalld is available
    if ! command -v firewall-cmd &> /dev/null; then
        log_warn "firewalld not installed - skipping firewall configuration"
        log_warn "Manual firewall configuration may be required"
        return
    fi
    
    # Start firewalld if not running
    if ! systemctl is-active --quiet firewalld; then
        systemctl start firewalld
        systemctl enable firewalld
        log_detail "Started and enabled firewalld"
    fi
    
    # Get current configuration values
    local config_file="$CONFIG_DIR/config.jsonc"
    if ! validate_and_get_config "$config_file"; then
        log_error "Failed to read configuration for firewall setup"
        return 1
    fi
    
    log_info "Opening firewall ports..."
    log_detail "  HTTP Port: $CONFIG_HTTP_PORT"
    log_detail "  SSL Port: $CONFIG_SSL_PORT"
    log_detail "  DIMSE Port: $CONFIG_DIMSE_PORT"
    
    # Add firewall rules
    for port in "$CONFIG_HTTP_PORT" "$CONFIG_SSL_PORT" "$CONFIG_DIMSE_PORT"; do
        firewall-cmd --permanent --add-port=${port}/tcp 2>/dev/null || true
        log_detail "Added firewall rule for port $port/tcp"
    done
    
    firewall-cmd --reload
    log_success "Firewall configured and reloaded"
    
    # Show current firewall status
    log_detail "Current open ports:"
    firewall-cmd --list-ports | sed 's/^/  /'
}

# Simplified SELinux configuration - disable if causing issues
configure_selinux() {
    log_info "Configuring SELinux..."
    
    # Check SELinux status
    if ! command -v getenforce &> /dev/null; then
        log_detail "SELinux tools not installed - skipping"
        return
    fi
    
    local selinux_status=$(getenforce)
    log_detail "SELinux status: $selinux_status"
    
    if [[ "$selinux_status" == "Disabled" ]]; then
        log_info "SELinux is disabled - skipping configuration"
        return
    fi
    
    # If running as root, we can be more permissive
    if [[ "$RUN_AS_ROOT" == "true" ]]; then
        log_warn "Running as root - setting SELinux to permissive mode for this service"
        semanage permissive -a init_t 2>/dev/null || true
    fi
    
    # Set basic permissions
    if command -v setsebool &> /dev/null; then
        setsebool -P httpd_can_network_connect 1 2>/dev/null || true
        log_detail "Set SELinux boolean: httpd_can_network_connect=1"
    fi
    
    # Set context for binary
    if command -v chcon &> /dev/null; then
        chcon -t bin_t "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || true
        log_detail "Set SELinux context for binary"
    fi
    
    log_success "SELinux configuration completed"
    
    # If SELinux is causing issues, provide clear guidance
    if [[ "$selinux_status" == "Enforcing" ]]; then
        log_warn "If the service fails to start due to SELinux, you can:"
        log_warn "  1. Temporarily disable SELinux: setenforce 0"
        log_warn "  2. Or run installer with: RUN_AS_ROOT=true $0"
    fi
}

# Test configuration and connectivity
test_installation() {
    log_info "Testing installation..."
    
    # Check if binary is executable
    if [[ -x "$INSTALL_DIR/$BINARY_NAME" ]]; then
        log_success "Binary is executable"
    else
        log_error "Binary is not executable"
    fi
    
    # Check if configuration is valid
    local config_file="$CONFIG_DIR/config.jsonc"
    if validate_and_get_config "$config_file"; then
        log_success "Configuration is valid"
    else
        log_error "Configuration validation failed"
    fi
    
    # Check if service file exists
    if [[ -f "$SYSTEMD_DIR/$SERVICE_NAME.service" ]]; then
        log_success "Service file exists"
    else
        log_error "Service file missing"
    fi
    
    # Check certificate files if SSL is enabled
    if [[ "$CONFIG_SSL_ENABLED" == "true" ]]; then
        if [[ -f "$CERTS_DIR/server.crt" && -f "$CERTS_DIR/server.key" ]]; then
            log_success "SSL certificates found"
        else
            log_error "SSL certificates missing"
        fi
    fi
    
    log_info "Installation test complete"
}

# Enhanced usage display
show_usage() {
    echo ""
    echo "=========================================="
    echo "   DICOM Web Proxy Installation Complete"
    echo "=========================================="
    echo ""
    echo "Installation Summary:"
    echo "  Install Directory: $INSTALL_DIR"
    echo "  Service User: $SERVICE_USER"
    echo "  Configuration: $CONFIG_DIR/config.jsonc"
    
    if [[ -n "$CONFIG_HTTP_PORT" ]]; then
        echo ""
        echo "Service Endpoints:"
        echo "  HTTP: http://localhost:$CONFIG_HTTP_PORT"
        if [[ "$CONFIG_SSL_ENABLED" == "true" ]]; then
            echo "  HTTPS: https://localhost:$CONFIG_SSL_PORT"
        fi
        if [[ -n "$CONFIG_DIMSE_PORT" ]]; then
            echo "  DIMSE: port $CONFIG_DIMSE_PORT"
        fi
    fi
    
    echo ""
    echo "Service Management Commands:"
    echo "  Start:   sudo systemctl start $SERVICE_NAME"
    echo "  Stop:    sudo systemctl stop $SERVICE_NAME"
    echo "  Restart: sudo systemctl restart $SERVICE_NAME"
    echo "  Status:  sudo systemctl status $SERVICE_NAME"
    echo "  Logs:    sudo journalctl -u $SERVICE_NAME -f"
    
    echo ""
    echo "Quick Start:"
    echo "  1. Start the service:"
    echo "     sudo systemctl start $SERVICE_NAME"
    echo ""
    echo "  2. Check service status:"
    echo "     sudo systemctl status $SERVICE_NAME"
    echo ""
    echo "  3. Monitor logs:"
    echo "     sudo journalctl -u $SERVICE_NAME -f"
    
    if [[ "$CONFIG_SSL_ENABLED" == "true" ]] && [[ ! -f "$CERTS_DIR/server.crt" ]]; then
        echo ""
        echo "⚠️  WARNING: SSL is enabled but certificates are missing!"
        echo "   The service will fail to start. Please either:"
        echo "   - Install certificates to: $CERTS_DIR/"
        echo "   - Or disable SSL in: $CONFIG_DIR/config.jsonc"
    fi
    
    echo ""
    echo "Troubleshooting:"
    echo "  If service fails to start:"
    echo "  - Check logs: journalctl -u $SERVICE_NAME -n 50"
    echo "  - Verify config: cat $CONFIG_DIR/config.jsonc"
    echo "  - Check permissions: ls -la $INSTALL_DIR/"
    
    if [[ "$RUN_AS_ROOT" != "true" ]]; then
        echo "  - For maximum compatibility, reinstall with: RUN_AS_ROOT=true $0"
    fi
    
    echo ""
    echo "=========================================="
}

# Main installation
main() {
    log_info "Starting DICOM Web Proxy installation..."
    log_info "Install mode: $([ "$RUN_AS_ROOT" == "true" ] && echo "ROOT (maximum compatibility)" || echo "SERVICE USER (secure)")"
    echo ""
    
    check_root
    check_rhel
    
    # Validate configuration first
    local config_file="./config/config.jsonc"
    if [[ ! -f "$config_file" ]]; then
        log_error "Configuration file not found: $config_file"
        log_error "Please ensure the config directory exists with a valid config.jsonc file"
        exit 1
    fi
    
    if ! validate_and_get_config "$config_file"; then
        log_error "Configuration validation failed. Please fix errors and retry."
        exit 1
    fi
    
    install_dependencies
    create_user
    create_directories
    install_application
    install_service
    install_certificates
    configure_firewall
    configure_selinux
    test_installation
    show_usage
}

# Handle script arguments
case "${1:-install}" in
    install)
        main
        ;;
    test)
        check_root
        test_installation
        ;;
    uninstall)
        check_root
        log_info "Uninstalling DICOM Web Proxy..."
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        rm -f "$SYSTEMD_DIR/$SERVICE_NAME.service"
        systemctl daemon-reload
        
        # Remove firewall rules
        if command -v firewall-cmd &> /dev/null; then
            firewall-cmd --permanent --remove-port=3006/tcp 2>/dev/null || true
            firewall-cmd --permanent --remove-port=443/tcp 2>/dev/null || true
            firewall-cmd --permanent --remove-port=8888/tcp 2>/dev/null || true
            firewall-cmd --reload 2>/dev/null || true
        fi
        
        if [[ "$SERVICE_USER" != "root" ]]; then
            userdel "$SERVICE_USER" 2>/dev/null || true
            groupdel "$SERVICE_GROUP" 2>/dev/null || true
        fi
        
        # Ask before removing files
        read -p "Remove all application files at $INSTALL_DIR? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$INSTALL_DIR"
            log_success "All files removed"
        else
            log_info "Files preserved at $INSTALL_DIR"
        fi
        
        log_success "Uninstallation completed"
        ;;
    *)
        echo "Usage: $0 [install|test|uninstall]"
        echo ""
        echo "Options:"
        echo "  install   - Install and configure the service (default)"
        echo "  test      - Test the installation"
        echo "  uninstall - Remove the service and optionally all files"
        echo ""
        echo "Environment Variables:"
        echo "  RUN_AS_ROOT=true - Run service as root for maximum compatibility"
        echo ""
        echo "Examples:"
        echo "  sudo $0 install                    # Standard installation"
        echo "  sudo RUN_AS_ROOT=true $0 install   # Install with root privileges"
        echo "  sudo $0 test                       # Test current installation"
        exit 1
        ;;
esac