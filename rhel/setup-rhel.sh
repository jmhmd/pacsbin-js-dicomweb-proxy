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

# Parse and validate configuration file with strict error handling
get_config_info() {
    # During installation, read from build directory; after installation, read from installed location
    local config_file
    if [[ -f "./config/config.jsonc" ]]; then
        config_file="./config/config.jsonc"
    else
        config_file="$CONFIG_DIR/config.jsonc"
    fi
    
    # Check if config file exists
    if [[ ! -f "$config_file" ]]; then
        log_error "Configuration file not found: $config_file"
        log_error "The configuration file is required for installation."
        log_error "Make sure you have a config.jsonc file in the config/ directory of your build package."
        exit 1
    fi
    
    # Validate configuration using Python
    if ! command -v python3 &> /dev/null; then
        log_error "Python3 is required for configuration parsing but is not available"
        log_error "Please install Python3: dnf install -y python3"
        exit 1
    fi
    
    # Parse and validate configuration
    local parsed_result=$(python3 -c "
import json, sys, re
try:
    with open('$config_file') as f:
        content = f.read()
    
    # Remove single-line comments (// style)
    content = re.sub(r'//.*?\n', '\n', content)
    # Remove multi-line comments (/* */ style)
    content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
    # Remove trailing commas before closing braces/brackets
    content = re.sub(r',(\s*[}\]])', r'\1', content)
    
    config = json.loads(content)
    
    # Validate required fields
    errors = []
    
    # Check proxy mode
    proxy_mode = config.get('proxyMode')
    if not proxy_mode:
        errors.append('Missing required field: proxyMode')
    elif proxy_mode not in ['dimse', 'dicomweb']:
        errors.append(f'Invalid proxyMode: {proxy_mode} (must be \"dimse\" or \"dicomweb\")')
    
    # Validate DIMSE settings if in DIMSE mode
    if proxy_mode == 'dimse':
        dimse = config.get('dimseProxySettings', {})
        if not dimse:
            errors.append('Missing dimseProxySettings for DIMSE proxy mode')
        else:
            proxy_server = dimse.get('proxyServer', {})
            if not proxy_server.get('aet'):
                errors.append('Missing dimseProxySettings.proxyServer.aet')
            if not proxy_server.get('port'):
                errors.append('Missing dimseProxySettings.proxyServer.port')
            
            peers = dimse.get('peers', [])
            if not peers:
                errors.append('Missing dimseProxySettings.peers (at least one DIMSE peer required)')
            else:
                for i, peer in enumerate(peers):
                    if not peer.get('aet'):
                        errors.append(f'Missing aet for DIMSE peer {i+1}')
                    if not peer.get('ip'):
                        errors.append(f'Missing ip for DIMSE peer {i+1}')
                    if not peer.get('port'):
                        errors.append(f'Missing port for DIMSE peer {i+1}')
    
    # Validate DICOMWEB settings if in DICOMWEB mode
    elif proxy_mode == 'dicomweb':
        dicomweb = config.get('dicomwebProxySettings', {})
        if not dicomweb:
            errors.append('Missing dicomwebProxySettings for DICOMWEB proxy mode')
        else:
            if not dicomweb.get('qidoForwardingUrl'):
                errors.append('Missing dicomwebProxySettings.qidoForwardingUrl')
            if not dicomweb.get('wadoForwardingUrl'):
                errors.append('Missing dicomwebProxySettings.wadoForwardingUrl')
    
    # Check SSL configuration
    ssl = config.get('ssl', {})
    ssl_enabled = ssl.get('enabled', False)
    if ssl_enabled:
        if not ssl.get('certPath'):
            errors.append('SSL is enabled but certPath is missing')
        if not ssl.get('keyPath'):
            errors.append('SSL is enabled but keyPath is missing')
    
    # If there are validation errors, print them and exit
    if errors:
        print('VALIDATION_FAILED')
        for error in errors:
            sys.stderr.write(f'CONFIG ERROR: {error}\\n')
        sys.exit(1)
    
    # Extract configuration values
    http_port = config.get('webserverPort', 3006)
    ssl_port = ssl.get('port', 443)
    ssl_enabled_str = str(ssl_enabled).lower()
    cert_path = ssl.get('certPath', '/opt/dicomweb-proxy/certs/server.crt')
    key_path = ssl.get('keyPath', '/opt/dicomweb-proxy/certs/server.key')
    
    dimse = config.get('dimseProxySettings', {})
    proxy_server = dimse.get('proxyServer', {})
    dimse_port = proxy_server.get('port', 8888)
    
    print(f'{http_port} {ssl_port} {dimse_port} {cert_path} {key_path} {ssl_enabled_str}')
    
except json.JSONDecodeError as e:
    print('PARSE_FAILED')
    sys.stderr.write(f'CONFIG PARSE ERROR: Invalid JSON in configuration file: {str(e)}\\n')
    sys.exit(1)
except Exception as e:
    print('PARSE_FAILED')
    sys.stderr.write(f'CONFIG ERROR: Failed to parse configuration: {str(e)}\\n')
    sys.exit(1)
" 2>&1)
    
    local python_exit_code=$?
    
    # Check if parsing failed
    if [[ $python_exit_code -ne 0 || "$parsed_result" == "VALIDATION_FAILED" || "$parsed_result" == "PARSE_FAILED" ]]; then
        log_error "Configuration validation failed for: $config_file"
        log_error "Please fix the configuration errors listed above and try again."
        exit 1
    fi
    
    echo "$parsed_result"
}

get_config_ports() {
    # During installation, read from build directory; after installation, read from installed location
    local config_file
    if [[ -f "./config/config.jsonc" ]]; then
        config_file="./config/config.jsonc"
    else
        config_file="$CONFIG_DIR/config.jsonc"
    fi
    
    if [[ ! -f "$config_file" ]]; then
        log_error "Configuration file not found at $config_file"
        exit 1
    fi
    
    # Parse just the port information we need
    if ! command -v python3 &> /dev/null; then
        log_error "Python3 is required for configuration parsing"
        exit 1
    fi
    
    local port_info=$(python3 -c "
import json, sys, re
try:
    with open('$config_file') as f:
        content = f.read()
    
    # Remove comments using the same logic as validation
    lines = content.split('\\n')
    cleaned_lines = []
    
    for line in lines:
        in_string = False
        escaped = False
        comment_start = -1
        
        i = 0
        while i < len(line):
            char = line[i]
            
            if escaped:
                escaped = False
            elif char == '\\\\' and in_string:
                escaped = True
            elif char == '\"' and not escaped:
                in_string = not in_string
            elif not in_string and char == '/' and i + 1 < len(line) and line[i + 1] == '/':
                comment_start = i
                break
            
            i += 1
        
        if comment_start >= 0:
            line = line[:comment_start].rstrip()
        
        cleaned_lines.append(line)
    
    content = '\\n'.join(cleaned_lines)
    content = re.sub(r'/\\*.*?\\*/', '', content, flags=re.DOTALL)
    content = re.sub(r',\\s*([}\\]])', r'\\1', content)
    
    config = json.loads(content)
    
    # Extract ports
    http_port = config.get('webserverPort', 3006)
    ssl = config.get('ssl', {})
    ssl_port = ssl.get('port', 443)
    
    dimse = config.get('dimseProxySettings', {})
    proxy_server = dimse.get('proxyServer', {})
    dimse_port = proxy_server.get('port', 8888)
    
    print(f'{http_port} {ssl_port} {dimse_port}')
    
except Exception as e:
    sys.stderr.write(f'Port parsing error: {str(e)}\\n')
    sys.exit(1)
" 2>/dev/null)
    
    if [[ $? -ne 0 ]]; then
        log_error "Failed to parse port information from configuration"
        exit 1
    fi
    
    echo "$port_info"
}

# Validate configuration from build directory before installation
validate_configuration() {
    log_info "Validating configuration..."
    
    local build_config_file="./config/config.jsonc"
    
    # Check if config file exists in the build directory
    if [[ ! -f "$build_config_file" ]]; then
        log_error "Configuration file not found: $build_config_file"
        log_error "The build package must contain a config.jsonc file."
        log_error "Make sure you built the package correctly with a valid configuration."
        exit 1
    fi
    
    # Validate configuration using Python
    if ! command -v python3 &> /dev/null; then
        log_error "Python3 is required for configuration parsing but is not available"
        log_error "Please install Python3: dnf install -y python3"
        exit 1
    fi
    
    # Parse and validate the build configuration
    log_info "Running validation with Python3..."
    
    python3 -c "
import json, sys, re

def log_error(msg):
    print(f'[VALIDATION ERROR] {msg}')

try:
    with open('$build_config_file') as f:
        content = f.read()
    
    # More careful JSONC parsing
    lines = content.split('\\n')
    cleaned_lines = []
    
    for line in lines:
        # Remove single-line comments, but preserve strings that contain //
        in_string = False
        escaped = False
        comment_start = -1
        
        i = 0
        while i < len(line):
            char = line[i]
            
            if escaped:
                escaped = False
            elif char == '\\\\' and in_string:
                escaped = True
            elif char == '\"' and not escaped:
                in_string = not in_string
            elif not in_string and char == '/' and i + 1 < len(line) and line[i + 1] == '/':
                comment_start = i
                break
            
            i += 1
        
        if comment_start >= 0:
            line = line[:comment_start].rstrip()
        
        cleaned_lines.append(line)
    
    content = '\\n'.join(cleaned_lines)
    
    # Remove multi-line comments
    content = re.sub(r'/\\*.*?\\*/', '', content, flags=re.DOTALL)
    
    # Remove trailing commas before closing braces/brackets
    content = re.sub(r',\\s*([}\\]])', r'\\1', content)
    
    # Debug: uncomment to show processed JSON if needed
    # print(f'[DEBUG] Processed JSON content:', file=sys.stderr)
    # print(content, file=sys.stderr)
    # print('[DEBUG] End of processed JSON', file=sys.stderr)
    
    config = json.loads(content)
    
    # Validate required fields
    errors = []
    
    # Check proxy mode
    proxy_mode = config.get('proxyMode')
    if not proxy_mode:
        errors.append('Missing required field: proxyMode')
    elif proxy_mode not in ['dimse', 'dicomweb']:
        errors.append(f'Invalid proxyMode: {proxy_mode} (must be \"dimse\" or \"dicomweb\")')
    
    # Validate DIMSE settings if in DIMSE mode
    if proxy_mode == 'dimse':
        dimse = config.get('dimseProxySettings', {})
        if not dimse:
            errors.append('Missing dimseProxySettings for DIMSE proxy mode')
        else:
            proxy_server = dimse.get('proxyServer', {})
            if not proxy_server.get('aet'):
                errors.append('Missing dimseProxySettings.proxyServer.aet')
            if not proxy_server.get('port'):
                errors.append('Missing dimseProxySettings.proxyServer.port')
            
            peers = dimse.get('peers', [])
            if not peers:
                errors.append('Missing dimseProxySettings.peers (at least one DIMSE peer required)')
            else:
                for i, peer in enumerate(peers):
                    if not peer.get('aet'):
                        errors.append(f'Missing aet for DIMSE peer {i+1}')
                    if not peer.get('ip'):
                        errors.append(f'Missing ip for DIMSE peer {i+1}')
                    if not peer.get('port'):
                        errors.append(f'Missing port for DIMSE peer {i+1}')
    
    # Validate DICOMWEB settings if in DICOMWEB mode
    elif proxy_mode == 'dicomweb':
        dicomweb = config.get('dicomwebProxySettings', {})
        if not dicomweb:
            errors.append('Missing dicomwebProxySettings for DICOMWEB proxy mode')
        else:
            if not dicomweb.get('qidoForwardingUrl'):
                errors.append('Missing dicomwebProxySettings.qidoForwardingUrl')
            if not dicomweb.get('wadoForwardingUrl'):
                errors.append('Missing dicomwebProxySettings.wadoForwardingUrl')
    
    # Check SSL configuration
    ssl = config.get('ssl', {})
    ssl_enabled = ssl.get('enabled', False)
    if ssl_enabled:
        if not ssl.get('certPath'):
            errors.append('SSL is enabled but certPath is missing')
        if not ssl.get('keyPath'):
            errors.append('SSL is enabled but keyPath is missing')
    
    # If there are validation errors, print them and exit
    if errors:
        log_error('Configuration validation failed with the following errors:')
        for error in errors:
            log_error(f'  - {error}')
        sys.exit(1)
    
    print('[VALIDATION SUCCESS] Configuration is valid')
    
except json.JSONDecodeError as e:
    log_error(f'Invalid JSON syntax in configuration file: {str(e)}')
    sys.exit(1)
except FileNotFoundError:
    log_error(f'Configuration file not found: $build_config_file')
    sys.exit(1)
except Exception as e:
    log_error(f'Failed to parse configuration: {str(e)}')
    sys.exit(1)
"
    
    local python_exit_code=$?
    
    # Check if validation failed
    if [[ $python_exit_code -ne 0 ]]; then
        log_error "Configuration validation failed for: $build_config_file"
        log_error "Please fix the configuration errors listed above and rebuild the package."
        exit 1
    fi
    
    log_success "Configuration validation passed"
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
    
    # Debug: show extracted port values
    log_info "Extracted port values: HTTP=$http_port, SSL=$ssl_port, DIMSE=$dimse_port"
    
    # Validate port values are numeric
    if ! [[ "$http_port" =~ ^[0-9]+$ ]]; then
        log_error "Invalid HTTP port value: '$http_port' (must be numeric)"
        exit 1
    fi
    if ! [[ "$ssl_port" =~ ^[0-9]+$ ]]; then
        log_error "Invalid SSL port value: '$ssl_port' (must be numeric)"
        exit 1
    fi
    if ! [[ "$dimse_port" =~ ^[0-9]+$ ]]; then
        log_error "Invalid DIMSE port value: '$dimse_port' (must be numeric)"
        exit 1
    fi
    
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

# Install and configure SSL certificates by copying to standard location
install_certificates() {
    log_info "Configuring SSL certificates..."
    
    # Get certificate paths from config (for reading source locations)
    local config_info=($(get_config_info))
    local source_cert_path="${config_info[3]}"
    local source_key_path="${config_info[4]}"
    local ssl_enabled="${config_info[5]}"
    
    # Always use standard paths for actual deployment
    local target_cert_path="$CERTS_DIR/server.crt"
    local target_key_path="$CERTS_DIR/server.key"
    
    if [[ "$ssl_enabled" != "true" ]]; then
        log_info "SSL is disabled in config, skipping certificate setup"
        return 0
    fi
    
    log_info "SSL enabled - installing certificates to standard location:"
    log_info "  Target certificate: $target_cert_path"
    log_info "  Target key: $target_key_path"
    
    # Backup existing certificates if they exist
    if [[ -f "$target_cert_path" ]]; then
        cp "$target_cert_path" "$target_cert_path.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "Existing certificate backed up"
    fi
    if [[ -f "$target_key_path" ]]; then
        cp "$target_key_path" "$target_key_path.backup.$(date +%Y%m%d_%H%M%S)"
        log_info "Existing key backed up"
    fi
    
    # Try to find and copy certificates from various sources
    local found_certs=false
    local search_sources=(
        # First try the configured paths
        "$source_cert_path:$source_key_path"
        # Then try common locations
        "/opt/certs/server.crt:/opt/certs/server.key"
        "/etc/ssl/certs/server.crt:/etc/ssl/certs/server.key"
        "/etc/pki/tls/certs/server.crt:/etc/pki/tls/certs/server.key"
        "./certs/server.crt:./certs/server.key"
        "$(pwd)/certs/server.crt:$(pwd)/certs/server.key"
    )
    
    for source_pair in "${search_sources[@]}"; do
        local cert_src="${source_pair%%:*}"
        local key_src="${source_pair##*:}"
        
        if [[ -f "$cert_src" && -f "$key_src" ]]; then
            log_info "Found certificates at $cert_src and $key_src, copying to standard location"
            
            # Copy certificates to standard location
            cp "$cert_src" "$target_cert_path"
            cp "$key_src" "$target_key_path"
            
            # Set proper ownership and permissions on copied files
            chown "$SERVICE_USER:$SERVICE_GROUP" "$target_cert_path" "$target_key_path"
            chmod 644 "$target_cert_path"
            chmod 600 "$target_key_path"
            
            # Set SELinux contexts on the standard directory
            if command -v getenforce &> /dev/null && [[ $(getenforce) != "Disabled" ]]; then
                if command -v semanage &> /dev/null; then
                    semanage fcontext -a -t cert_t "$CERTS_DIR(/.*)?$" 2>/dev/null || true
                    restorecon -Rv "$CERTS_DIR" 2>/dev/null || true
                fi
            fi
            
            found_certs=true
            log_success "Certificates copied and configured at standard location"
            break
        fi
    done
    
    if [[ "$found_certs" != "true" ]]; then
        log_warn "No SSL certificates found in any searched locations"
        log_warn "Searched locations:"
        log_warn "  - Configured paths: $source_cert_path, $source_key_path"
        log_warn "  - /opt/certs/, /etc/ssl/certs/, /etc/pki/tls/certs/, ./certs/"
        log_warn ""
        log_warn "Please place your SSL certificates at the standard location:"
        log_warn "  Certificate: $target_cert_path"
        log_warn "  Key: $target_key_path"
        log_warn "Or disable SSL in the configuration"
    fi
}

# Update configuration to use standard certificate paths
update_config_cert_paths() {
    local config_file="$CONFIG_DIR/config.jsonc"
    
    if [[ ! -f "$config_file" ]]; then
        return 0
    fi
    
    log_info "Updating configuration to use standard certificate paths..."
    
    # Update certificate paths in config to use standard locations
    # This ensures the service looks for certificates in our managed directory
    sed -i 's|"certPath":[[:space:]]*"[^"]*"|"certPath": "/opt/dicomweb-proxy/certs/server.crt"|g' "$config_file"
    sed -i 's|"keyPath":[[:space:]]*"[^"]*"|"keyPath": "/opt/dicomweb-proxy/certs/server.key"|g' "$config_file"
    
    log_success "Configuration updated to use standard certificate paths"
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
        
        # Configure SELinux contexts for the standard certificate directory
        if [[ "$ssl_enabled" == "true" ]]; then
            if command -v semanage &> /dev/null; then
                # Set context for the standard certificate directory
                semanage fcontext -a -t cert_t "$CERTS_DIR(/.*)?" 2>/dev/null || true
                restorecon -Rv "$CERTS_DIR" 2>/dev/null || true
                
                log_info "SELinux contexts configured for certificate directory: $CERTS_DIR"
            fi
        fi
        
        log_success "SELinux configured for ports $http_port, $ssl_port, and $dimse_port"
    else
        log_info "SELinux is disabled, skipping SELinux configuration"
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
    local ssl_enabled="${config_info[5]}"
    
    if [[ "$ssl_enabled" == "true" ]]; then
        echo "  - SSL is enabled. Certificates are managed at standard location:"
        echo "    Certificate: $CERTS_DIR/server.crt"
        echo "    Key:         $CERTS_DIR/server.key"
        echo "  - If SSL still fails, verify certificate file permissions:"
        echo "    sudo chmod 644 $CERTS_DIR/server.crt"
        echo "    sudo chmod 600 $CERTS_DIR/server.key"
        echo "    sudo chown $SERVICE_USER:$SERVICE_GROUP $CERTS_DIR/server.crt $CERTS_DIR/server.key"
        echo "    sudo restorecon -v $CERTS_DIR/server.crt $CERTS_DIR/server.key"
    else
        echo "  - SSL is disabled in configuration"
    fi
}

# Main installation function
main() {
    log_info "Starting DICOM Web Proxy installation for RHEL..."
    
    check_root
    check_rhel
    validate_configuration
    install_dependencies
    create_user
    create_directories
    install_application
    install_service
    install_certificates
    update_config_cert_paths
    configure_firewall
    configure_selinux
    show_usage
}

# Upgrade function for re-running with new binary or config
upgrade() {
    log_info "Upgrading DICOM Web Proxy..."
    
    check_root
    
    # Install application files, update certificates, and update firewall
    install_application
    install_certificates
    update_config_cert_paths
    configure_firewall
    
    log_success "Upgrade completed!"
    log_info "Service will use the new binary, configuration, and certificates"
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