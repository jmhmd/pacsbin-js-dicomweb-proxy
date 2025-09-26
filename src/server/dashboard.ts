import { ProxyConfig } from "../types";

export interface DashboardData {
  status: string;
  timestamp: string;
  version: string;
  proxyMode: string;
  uptime: number;
  memory: any;
  cache: any;
  dimseScpServer: any;
  config: ProxyConfig;
  authEnabled: boolean;
}

export function generateDashboardHTML(data: DashboardData): string {
  const memUsagePercent = (
    (data.memory.heapUsed / data.memory.heapTotal) * 100
  ).toFixed(1);
  const cacheEnabled = data.cache && data.cache.enabled !== false;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pacsbin DICOM Web Proxy - Dashboard</title>
    <style>
        ${getStyles()}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DICOM Web Proxy</h1>
            <p>Management Dashboard</p>
        </div>

        <div class="content">
            <div class="tabs">
                <button class="tab-button active" onclick="showTab('status')">Status</button>
                <button class="tab-button" onclick="showTab('config')">Configuration</button>
                <button class="tab-button" onclick="showTab('logs')">Logs</button>
            </div>

            <div id="status-tab" class="tab-content active">
                ${generateStatusTab(data, memUsagePercent, cacheEnabled)}
            </div>

            <div id="config-tab" class="tab-content">
                ${generateConfigTab(data)}
            </div>

            <div id="logs-tab" class="tab-content">
                ${generateLogsTab()}
            </div>
        </div>
    </div>

    <script>
        ${getJavaScript(data)}
    </script>
</body>
</html>`;
}

function getStyles(): string {
  return `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh; padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%); color: white; padding: 30px; text-align: center; }
        .header h1 { font-size: 2.5rem; margin-bottom: 10px; font-weight: 300; }
        .header p { font-size: 1.1rem; opacity: 0.9; }
        .content { padding: 30px; }

        /* Tabs */
        .tabs { display: flex; border-bottom: 2px solid #e9ecef; margin-bottom: 30px; }
        .tab-button {
            background: none; border: none; padding: 15px 25px; cursor: pointer;
            font-size: 1rem; color: #495057; border-bottom: 3px solid transparent;
            transition: all 0.3s ease;
        }
        .tab-button:hover { background: #f8f9fa; color: #2c3e50; }
        .tab-button.active { color: #3498db; border-bottom-color: #3498db; background: #f8f9fa; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }

        /* Status Tab */
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .status-card { background: #f8f9fa; border-radius: 8px; padding: 20px; border-left: 4px solid #28a745; }
        .status-card h3 { color: #2c3e50; margin-bottom: 15px; font-size: 1.2rem; }
        .status-item { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 8px 0; border-bottom: 1px solid #e9ecef; }
        .status-item:last-child { border-bottom: none; margin-bottom: 0; }
        .status-label { font-weight: 500; color: #495057; }
        .status-value { color: #2c3e50; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; }
        .status-indicator { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; background-color: #28a745; }
        .memory-bar { width: 100%; height: 8px; background-color: #e9ecef; border-radius: 4px; overflow: hidden; margin-top: 5px; }
        .memory-fill { height: 100%; background: linear-gradient(90deg, #28a745, #ffc107, #dc3545); }

        /* Config Tab */
        .config-section { margin-bottom: 30px; }
        .config-section h3 { color: #2c3e50; margin-bottom: 20px; font-size: 1.3rem; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: 500; color: #495057; }
        .form-group input, .form-group select, .form-group textarea, .form-control {
            width: 100%; padding: 10px; border: 1px solid #ced4da; border-radius: 4px;
            font-size: 1rem; font-family: inherit;
        }
        .form-group textarea { resize: vertical; min-height: 150px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .btn {
            padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer;
            font-size: 1rem; text-decoration: none; display: inline-block; text-align: center;
            transition: all 0.3s ease;
        }
        .btn-primary { background: #3498db; color: white; }
        .btn-primary:hover { background: #2980b9; transform: translateY(-2px); }
        .btn-success { background: #28a745; color: white; }
        .btn-success:hover { background: #218838; }
        .btn-warning { background: #ffc107; color: #212529; }
        .btn-warning:hover { background: #e0a800; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-danger:hover { background: #c82333; }

        /* Alerts */
        .alert { padding: 15px; border-radius: 6px; margin: 15px 0; }
        .alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .alert-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .alert-info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }

        /* Peer cards, echo buttons, etc. */
        .peer-card { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 15px; margin: 10px 0; }
        .peer-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .peer-title { font-weight: 600; color: #495057; }
        .echo-btn { background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
        .echo-btn:hover { background: #218838; }
        .echo-btn:disabled { background: #6c757d; cursor: not-allowed; }
        .echo-result { margin-top: 8px; padding: 8px; border-radius: 4px; font-size: 0.9rem; }
        .echo-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .echo-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .echo-testing { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }

        .endpoints { background: #f8f9fa; border-radius: 8px; padding: 20px; margin-top: 20px; }
        .endpoints h3 { color: #2c3e50; margin-bottom: 15px; }
        .endpoint-link { display: inline-block; background: #007bff; color: white; text-decoration: none; padding: 8px 16px; border-radius: 4px; margin: 5px 5px 5px 0; font-size: 0.9rem; }
        .endpoint-link:hover { background: #0056b3; }

        .refresh-btn { background: linear-gradient(135deg, #3498db 0%, #2c3e50 100%); color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem; display: block; margin: 20px auto 0; }
        .refresh-btn:hover { transform: translateY(-2px); }

        /* Auth */
        .login-form { max-width: 400px; margin: 50px auto; padding: 30px; background: white; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
        .auth-status { text-align: right; margin-bottom: 20px; }
        .auth-status.authenticated { color: #28a745; }
        .auth-status.unauthenticated { color: #dc3545; }

        @media (max-width: 768px) {
            .status-grid { grid-template-columns: 1fr; }
            .header h1 { font-size: 2rem; }
            .content { padding: 20px; }
            .form-row { grid-template-columns: 1fr; }
            .tabs { flex-wrap: wrap; }
        }
  `;
}

function generateStatusTab(data: DashboardData, memUsagePercent: string, cacheEnabled: boolean): string {
  return `
    <div class="status-grid">
        <div class="status-card">
            <h3><span class="status-indicator"></span>General Status</h3>
            <div class="status-item"><span class="status-label">Status:</span><span class="status-value">${data.status}</span></div>
            <div class="status-item"><span class="status-label">Version:</span><span class="status-value">${data.version}</span></div>
            <div class="status-item"><span class="status-label">Proxy Mode:</span><span class="status-value">${data.proxyMode}</span></div>
            <div class="status-item"><span class="status-label">Last Updated:</span><span class="status-value">${new Date(data.timestamp).toLocaleString()}</span></div>
        </div>

        <div class="status-card">
            <h3>System Information</h3>
            <div class="status-item"><span class="status-label">Uptime:</span><span class="status-value">${formatUptime(data.uptime)}</span></div>
            <div class="status-item"><span class="status-label">Web Server:</span><span class="status-value">Port ${data.config.webserverPort}</span></div>
            <div class="status-item"><span class="status-label">SSL:</span><span class="status-value">${data.config.ssl.enabled ? `Enabled (Port ${data.config.ssl.port})` : "Disabled"}</span></div>
            <div class="status-item"><span class="status-label">Cache:</span><span class="status-value">${data.config.enableCache ? "Enabled" : "Disabled"}</span></div>
        </div>

        <div class="status-card">
            <h3>Memory Usage</h3>
            <div class="status-item"><span class="status-label">Heap Used:</span><span class="status-value">${formatBytes(data.memory.heapUsed)}</span></div>
            <div class="status-item"><span class="status-label">Heap Total:</span><span class="status-value">${formatBytes(data.memory.heapTotal)}</span></div>
            <div class="status-item"><span class="status-label">RSS:</span><span class="status-value">${formatBytes(data.memory.rss)}</span></div>
            <div class="memory-bar"><div class="memory-fill" style="width: ${memUsagePercent}%"></div></div>
        </div>

        <div class="status-card">
            <h3>Cache Status</h3>
            ${cacheEnabled ? `
            <div class="status-item"><span class="status-label">Total Size:</span><span class="status-value">${formatBytes(data.cache.totalSize || 0)}</span></div>
            <div class="status-item"><span class="status-label">Entry Count:</span><span class="status-value">${data.cache.entryCount || 0}</span></div>
            <div class="status-item"><span class="status-label">Hit Rate:</span><span class="status-value">${((data.cache.hitRate || 0) * 100).toFixed(1)}%</span></div>
            ` : '<div class="status-item"><span class="status-label">Status:</span><span class="status-value">Disabled</span></div>'}
        </div>

        ${data.dimseScpServer ? `
        <div class="status-card">
            <h3><span class="status-indicator"></span>DIMSE SCP Server</h3>
            <div class="status-item"><span class="status-label">Status:</span><span class="status-value">${data.dimseScpServer.isRunning ? "Running" : "Stopped"}</span></div>
            <div class="status-item"><span class="status-label">Listen Port:</span><span class="status-value">${data.dimseScpServer.port}</span></div>
            <div class="status-item"><span class="status-label">Local AET:</span><span class="status-value">${data.dimseScpServer.aet}</span></div>
            <div class="status-item"><span class="status-label">Pending Requests:</span><span class="status-value">${data.dimseScpServer.requestTracker.pending}</span></div>
        </div>
        ` : data.proxyMode === "dimse" ? `
        <div class="status-card">
            <h3>DIMSE SCP Server</h3>
            <div class="status-item"><span class="status-label">Status:</span><span class="status-value">Disabled (Using C-GET)</span></div>
            <div class="status-item"><span class="status-label">Mode:</span><span class="status-value">C-GET (Direct)</span></div>
        </div>
        ` : ''}
    </div>

    ${data.proxyMode === "dimse" && data.config.dimseProxySettings ? generateDimseConfig(data.config.dimseProxySettings) : ''}

    <div class="endpoints">
        <h3>API Endpoints</h3>
        <a href="/status" class="endpoint-link" target="_blank">/status</a>
        <a href="/ping" class="endpoint-link" target="_blank">/ping</a>
    </div>

    <button class="refresh-btn" onclick="window.location.reload()">Refresh Status</button>
  `;
}

function generateDimseConfig(dimseConfig: any): string {
  return `
    <div class="endpoints">
        <h3>DIMSE Configuration</h3>
        <div class="status-item">
            <span class="status-label">Proxy AET:</span>
            <span class="status-value">${dimseConfig.proxyServer.aet}</span>
        </div>
        <div class="status-item">
            <span class="status-label">Proxy Port:</span>
            <span class="status-value">${dimseConfig.proxyServer.port}</span>
        </div>

        <h4 style="margin: 15px 0 10px 0; color: #495057;">PACS Peers (${dimseConfig.peers.length})</h4>
        ${dimseConfig.peers.map((peer: any, index: number) => `
        <div class="peer-card">
            <div class="peer-header">
                <span class="peer-title">${peer.aet}</span>
                <button class="echo-btn" onclick="testEcho(${index})">C-ECHO Test</button>
            </div>
            <div class="status-item">
                <span class="status-label">Host:</span>
                <span class="status-value">${peer.ip}:${peer.port}</span>
            </div>
            <div id="echo-result-${index}"></div>
        </div>
        `).join('')}
    </div>
  `;
}

function generateConfigTab(data: DashboardData): string {
  return `
    <div class="auth-status ${data.authEnabled ? 'authenticated' : 'unauthenticated'}" id="auth-status">
        ${data.authEnabled ? '🔒 Authentication: Enabled' : '🔓 Authentication: Disabled'}
    </div>

    <div id="login-section" style="display: ${data.authEnabled ? 'block' : 'none'}">
        <div class="login-form" id="login-form" style="display: none">
            <h3>Configuration Access</h3>
            <div class="form-group">
                <label for="admin-password">Admin Password:</label>
                <input type="password" id="admin-password" placeholder="Enter admin password">
            </div>
            <button class="btn btn-primary" onclick="login()" style="width: 100%">Login</button>
            <div id="login-error" class="alert alert-error" style="display: none; margin-top: 15px;"></div>
        </div>

        <div id="logout-section" style="display: none; text-align: right; margin-bottom: 20px;">
            <span style="color: #28a745; margin-right: 15px;">✓ Authenticated</span>
            <button class="btn btn-warning" onclick="logout()">Logout</button>
        </div>
    </div>

    <div id="config-editor" style="display: ${data.authEnabled ? 'none' : 'block'}">
        <div class="config-section">
            <h3>Configuration Editor</h3>
            <p style="color: #6c757d; margin-bottom: 20px;">
                Edit your proxy configuration below. Changes will be validated before applying.
            </p>

            <div class="form-group">
                <label for="config-json">Configuration (JSON):</label>
                <textarea id="config-json" placeholder="Loading configuration..." rows=30>${JSON.stringify(data.config, null, 2)}</textarea>
            </div>

            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="btn btn-primary" onclick="validateConfig()">Validate Configuration</button>
                <button class="btn btn-success" onclick="applyConfig()">Apply & Restart</button>
                <button class="btn btn-warning" onclick="applyConfig(false)">Apply Without Restart</button>
                <button class="btn btn-danger" onclick="restartServer()">Restart Server</button>
            </div>
        </div>

        <div class="config-section">
            <h3>Certificate Upload</h3>
            <p style="color: #6c757d; margin-bottom: 20px;">
                Upload SSL certificates for HTTPS support.
            </p>

            <div class="form-row">
                <div class="form-group">
                    <label for="cert-file">Certificate File (.crt/.cer/.pem):</label>
                    <input type="file" id="cert-file" accept=".crt,.pem,.cer">
                </div>
                <div class="form-group">
                    <label for="key-file">Private Key File (.key/.pem):</label>
                    <input type="file" id="key-file" accept=".key,.pem">
                </div>
            </div>

            <button class="btn btn-primary" onclick="uploadCertificates()">Upload Certificates</button>
        </div>
    </div>

    <div id="config-alerts"></div>
  `;
}

function generateLogsTab(): string {
  return `
    <div class="config-section">
        <h3>System Logs</h3>
        <p style="color: #6c757d; margin-bottom: 20px;">
            Real-time system logs and events.
        </p>

        <div style="display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; align-items: center;">
            <select id="log-level-filter" class="form-control" style="width: auto;">
                <option value="">All Levels</option>
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
            </select>

            <input type="text" id="log-search" placeholder="Search logs..." class="form-control" style="width: 200px;">

            <button class="btn btn-primary" onclick="connectToLogs()">Connect</button>
            <button class="btn btn-warning" onclick="disconnectLogs()">Disconnect</button>
            <button class="btn btn-secondary" onclick="clearLogDisplay()">Clear Display</button>

            <div style="margin-left: auto; display: flex; gap: 10px;">
                <button class="btn btn-success" onclick="downloadLogs('text')">Download (Text)</button>
                <button class="btn btn-success" onclick="downloadLogs('json')">Download (JSON)</button>
            </div>
        </div>

        <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
            <div id="log-connection-status" style="color: #6c757d; font-size: 0.9rem;">
                Disconnected
            </div>
            <label style="display: flex; align-items: center; gap: 5px;">
                <input type="checkbox" id="auto-scroll-logs" checked> Auto-scroll
            </label>
        </div>

        <div id="logs-container" style="background: #2c3e50; color: #ecf0f1; padding: 15px; border-radius: 6px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; height: 500px; overflow-y: auto; font-size: 0.85rem; line-height: 1.4;">
            <div style="color: #95a5a6;">Click "Connect" to start streaming logs...</div>
        </div>
    </div>
  `;
}

function getJavaScript(data: DashboardData): string {
  return `
    let authToken = null;
    let authEnabled = ${data.authEnabled};

    // Tab functionality is now handled in the logs section

    // Authentication
    function checkAuthStatus() {
        if (!authEnabled) return;

        // Check if we have a valid session
        if (authToken || getCookie('sessionToken')) {
            showConfigEditor();
        } else {
            showLoginForm();
        }
    }

    function showLoginForm() {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('logout-section').style.display = 'none';
        document.getElementById('config-editor').style.display = 'none';
    }

    function showConfigEditor() {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('logout-section').style.display = authEnabled ? 'block' : 'none';
        document.getElementById('config-editor').style.display = 'block';
    }

    async function login() {
        const password = document.getElementById('admin-password').value;
        const errorDiv = document.getElementById('login-error');

        try {
            const response = await fetch('/config/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const result = await response.json();

            if (result.success) {
                authToken = result.sessionToken;
                showConfigEditor();
                errorDiv.style.display = 'none';
                document.getElementById('admin-password').value = '';
            } else {
                errorDiv.textContent = result.error || 'Login failed';
                errorDiv.style.display = 'block';
            }
        } catch (error) {
            errorDiv.textContent = 'Connection error: ' + error.message;
            errorDiv.style.display = 'block';
        }
    }

    async function logout() {
        try {
            await fetch('/config/logout', { method: 'POST' });
        } catch (error) {
            console.error('Logout error:', error);
        }

        authToken = null;
        showLoginForm();
    }

    // Configuration management
    async function validateConfig() {
        const configText = document.getElementById('config-json').value;

        try {
            const config = JSON.parse(configText);
            const response = await fetch('/config/test', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(config)
            });

            const result = await response.json();

            if (result.success) {
                showAlert('Configuration is valid!', 'success');
            } else {
                showAlert('Configuration error: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            showAlert('Invalid JSON: ' + error.message, 'error');
        }
    }

    async function applyConfig(restart = true) {
        const configText = document.getElementById('config-json').value;

        try {
            const config = JSON.parse(configText);
            const response = await fetch('/config/update', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    config: config,
                    restartAfterUpdate: restart
                })
            });

            const result = await response.json();

            if (result.success) {
                showAlert(result.message, 'success');
                if (result.restarting) {
                    showAlert('Server is restarting... Please refresh in a few seconds.', 'info');
                    setTimeout(() => window.location.reload(), 5000);
                }
            } else {
                showAlert('Update failed: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            showAlert('Request failed: ' + error.message, 'error');
        }
    }

    async function restartServer() {
        if (!confirm('Are you sure you want to restart the server?')) return;

        try {
            const response = await fetch('/config/restart', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ reason: 'Manual restart from dashboard' })
            });

            const result = await response.json();

            if (result.success) {
                showAlert('Server is restarting... Please refresh in a few seconds.', 'info');
                setTimeout(() => window.location.reload(), 5000);
            } else {
                showAlert('Restart failed: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            showAlert('Request failed: ' + error.message, 'error');
        }
    }

    async function uploadCertificates() {
        const certFile = document.getElementById('cert-file').files[0];
        const keyFile = document.getElementById('key-file').files[0];

        if (!certFile || !keyFile) {
            showAlert('Please select both certificate and key files', 'error');
            return;
        }

        try {
            const formData = new FormData();
            formData.append('cert', certFile);
            formData.append('key', keyFile);

            const response = await fetch('/config/upload-cert', {
                method: 'POST',
                headers: getAuthHeaders(false), // Don't set Content-Type for FormData
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                showAlert('Certificates uploaded successfully!', 'success');
                // Refresh config display
                setTimeout(() => window.location.reload(), 2000);
            } else {
                showAlert('Upload failed: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            showAlert('Upload failed: ' + error.message, 'error');
        }
    }

    // Real-time logging functionality
    let eventSource = null;
    let logBuffer = [];
    const maxLogBuffer = 1000;

    function connectToLogs() {
        if (eventSource) {
            disconnectLogs();
        }

        const level = document.getElementById('log-level-filter').value;
        const search = document.getElementById('log-search').value;

        let url = '/logs/stream';
        const params = new URLSearchParams();

        if (level) params.append('level', level);
        if (search) params.append('search', search);

        if (params.toString()) {
            url += '?' + params.toString();
        }

        updateConnectionStatus('Connecting...', '#ffc107');

        eventSource = new EventSource(url);

        eventSource.onopen = function() {
            updateConnectionStatus('Connected', '#28a745');
        };

        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'log') {
                    addLogEntry(data.payload);
                }
            } catch (error) {
                console.error('Error parsing log data:', error);
            }
        };

        eventSource.onerror = function(error) {
            console.error('EventSource failed:', error);
            updateConnectionStatus('Connection Error', '#dc3545');

            // Auto-reconnect after 5 seconds
            setTimeout(() => {
                if (eventSource && eventSource.readyState === EventSource.CLOSED) {
                    connectToLogs();
                }
            }, 5000);
        };

        eventSource.onclose = function() {
            updateConnectionStatus('Disconnected', '#6c757d');
        };
    }

    function disconnectLogs() {
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        updateConnectionStatus('Disconnected', '#6c757d');
    }

    function updateConnectionStatus(status, color) {
        const statusEl = document.getElementById('log-connection-status');
        statusEl.textContent = status;
        statusEl.style.color = color;
    }

    function addLogEntry(logEntry) {
        // Add to buffer
        logBuffer.push(logEntry);
        if (logBuffer.length > maxLogBuffer) {
            logBuffer.shift();
        }

        // Format and display
        const container = document.getElementById('logs-container');
        const logLine = formatLogEntry(logEntry);

        const logDiv = document.createElement('div');
        logDiv.innerHTML = logLine;
        logDiv.style.marginBottom = '2px';

        container.appendChild(logDiv);

        // Remove old entries if too many
        while (container.children.length > maxLogBuffer) {
            container.removeChild(container.firstChild);
        }

        // Auto-scroll if enabled
        if (document.getElementById('auto-scroll-logs').checked) {
            container.scrollTop = container.scrollHeight;
        }
    }

    function formatLogEntry(log) {
        const timestamp = new Date(log.time || log.timestamp || Date.now()).toLocaleTimeString();
        const level = (log.level || 'info').toUpperCase();
        const message = escapeHtml(log.msg || '');

        // Simple level colors
        const levelColors = {
            'FATAL': '#ff6b6b',
            'ERROR': '#ff6b6b',
            'WARN': '#feca57',
            'INFO': '#48cae4',
            'DEBUG': '#a8e6cf'
        };

        const levelColor = levelColors[level] || '#ecf0f1';

        return \`<span style="color: #7f8c8d;">[\${timestamp}]</span> <span style="color: \${levelColor}; font-weight: bold;">\${level.padEnd(5)}</span> <pre style="color: #ecf0f1;">\${message}</pre>\`;
    }

    function clearLogDisplay() {
        document.getElementById('logs-container').innerHTML = '<div style="color: #95a5a6;">Log display cleared.</div>';
        logBuffer = [];
    }

    async function downloadLogs(format) {
        const level = document.getElementById('log-level-filter').value;
        const search = document.getElementById('log-search').value;

        const params = new URLSearchParams();
        params.append('format', format);
        params.append('lines', '5000'); // Download last 5000 lines

        if (level) params.append('level', level);
        if (search) params.append('search', search);

        try {
            const response = await fetch('/logs/download?' + params.toString());

            if (!response.ok) {
                const error = await response.json();
                showAlert('Download failed: ' + (error.error || 'Unknown error'), 'error');
                return;
            }

            // Trigger download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || \`logs.\${format}\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            showAlert('Log download completed', 'success');
        } catch (error) {
            showAlert('Download failed: ' + error.message, 'error');
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Auto-connect on logs tab activation
    function showTab(tabName) {
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));

        document.getElementById(tabName + '-tab').classList.add('active');
        document.querySelector('[onclick="showTab(\\'' + tabName + '\\')"]').classList.add('active');

        if (tabName === 'config') {
            checkAuthStatus();
        } else if (tabName === 'logs') {
            if (!eventSource) {
                connectToLogs();
            }
        } else if (eventSource && tabName !== 'logs') {
            // Disconnect when leaving logs tab
            disconnectLogs();
        }
    }

    // C-ECHO test (from original dashboard)
    async function testEcho(peerIndex) {
        const resultDiv = document.getElementById('echo-result-' + peerIndex);
        const btn = event.target;

        btn.disabled = true;
        btn.textContent = 'Testing...';
        resultDiv.innerHTML = '<div class="echo-result echo-testing">Testing C-ECHO connection...</div>';

        try {
            const response = await fetch('/dimse/echo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peerIndex: peerIndex })
            });

            const result = await response.json();

            if (result.success) {
                resultDiv.innerHTML = \`
                    <div class="echo-result echo-success">
                        ✓ C-ECHO successful (\${result.responseTime}ms)
                    </div>
                \`;
            } else {
                resultDiv.innerHTML = \`
                    <div class="echo-result echo-error">
                        ✗ C-ECHO failed: \${result.error} (\${result.responseTime}ms)
                    </div>
                \`;
            }
        } catch (error) {
            resultDiv.innerHTML = \`
                <div class="echo-result echo-error">
                    ✗ Connection error: \${error.message}
                </div>
            \`;
        } finally {
            btn.disabled = false;
            btn.textContent = 'C-ECHO Test';
        }
    }

    // Utility functions
    function getAuthHeaders(includeContentType = true) {
        const headers = {};
        if (includeContentType) {
            headers['Content-Type'] = 'application/json';
        }
        if (authToken) {
            headers['Authorization'] = 'Bearer ' + authToken;
        }
        return headers;
    }

    function getCookie(name) {
        const value = \`; \${document.cookie}\`;
        const parts = value.split(\`; \${name}=\`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function showAlert(message, type) {
        const alertsContainer = document.getElementById('config-alerts');
        const alertDiv = document.createElement('div');
        alertDiv.className = \`alert alert-\${type}\`;
        alertDiv.textContent = message;

        alertsContainer.appendChild(alertDiv);

        setTimeout(() => {
            alertDiv.remove();
        }, 5000);
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return \`\${days}d \${hours}h \${minutes}m\`;
        if (hours > 0) return \`\${hours}h \${minutes}m\`;
        return \`\${minutes}m\`;
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
        if (authEnabled) {
            checkAuthStatus();
        }
    });
  `;
}

// Utility functions that mirror the ones in utils/format.ts
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}