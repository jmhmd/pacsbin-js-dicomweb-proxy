# Configuration Management Flow

This document details how configuration files and SSL certificates are managed during installation and runtime configuration updates for the DICOM Web Proxy application.

---

## Table of Contents

1. [Initial Installation](#initial-installation)
2. [Re-running the Installer](#re-running-the-installer)
3. [Web Interface Configuration Updates](#web-interface-configuration-updates)
4. [Certificate Management](#certificate-management)
5. [Backup Behavior Summary](#backup-behavior-summary)
6. [Configuration File Locations](#configuration-file-locations)

---

## Initial Installation

### Configuration Installation Process

**Location:** `src/installer.ts:470-484` (`installConfigurationFiles()`)

When running `install-rhel` for the first time:

1. **Pre-validation:** The config is validated BEFORE installation begins (`src/installer.ts:923-925`)
   ```typescript
   const configFile = './config/config.jsonc';
   this.config = this.validateConfigFile(configFile);
   ```

2. **Directory Check:** Installer looks for `./config` directory in the current working directory

3. **Backup Creation:** If a config file already exists at `/opt/dicomweb-proxy/config/config.jsonc`, a timestamped backup is created:
   - Format: `config.jsonc.backup.YYYY-MM-DDTHH-MM-SS-mmmZ`
   - Location: Same directory as original
   - Source: `src/installer.ts:418-424` (`createBackup()`)

4. **Copy Operation:** All files in `./config/*` are copied to `/opt/dicomweb-proxy/config/`
   ```bash
   cp -r ./config/* /opt/dicomweb-proxy/config/
   ```

5. **Permissions:** Config files get ownership set to service user (default: `dicomweb:dicomweb`) and permissions set to `644`

### Configuration Path Updates

**Location:** `src/installer.ts:617-658` (`updateConfigurationPaths()`)

After copying the config, the installer automatically updates certificate paths in the config file to use standardized locations:

- **HTTP SSL paths** updated to:
  - `certPath`: `/opt/dicomweb-proxy/certs/server.crt`
  - `keyPath`: `/opt/dicomweb-proxy/certs/server.key`

- **DIMSE TLS paths** updated to:
  - `cert`: `/opt/dicomweb-proxy/certs/dimse/server.crt`
  - `key`: `/opt/dicomweb-proxy/certs/dimse/server.key`
  - `ca`: `/opt/dicomweb-proxy/certs/dimse/ca.crt` (if specified)

---

## Re-running the Installer

### Behavior During Reinstall/Upgrade

When you run `install-rhel` again on an already installed system:

#### Configuration Files

1. **Existing Config Backup:** YES - Always created before overwriting
   - Location: `/opt/dicomweb-proxy/config/config.jsonc.backup.YYYY-MM-DDTHH-MM-SS-mmmZ`
   - Backup is created in `installConfigurationFiles()` → `createBackup()` (line 478)

2. **Overwrite Behavior:** The new config from `./config/config.jsonc` WILL overwrite the existing config

3. **Previous Backups:** Preserved - Each reinstall creates a new timestamped backup

#### Binary Files

1. **Binary Backup:** YES - Created before replacing
   - Format: `dicomweb-proxy-linux.backup.YYYY-MM-DDTHH-MM-SS-mmmZ`
   - Source: `src/installer.ts:440`

2. **Service Handling:** If the service is running, it's stopped before binary replacement and restarted after (lines 489-498)

#### Important Notes

- **Manual Config Edits Lost:** Any configuration changes made via the web interface will be OVERWRITTEN by the config from `./config/config.jsonc`
- **Backup Allows Recovery:** You can restore previous configs from the timestamped backups
- **Certificate Paths Reset:** Certificate paths in config will be rewritten to standard locations

---

## Web Interface Configuration Updates

### Runtime Configuration Changes

**Location:** `src/handlers/config.ts` and `src/config/config.ts`

The web dashboard allows editing configuration at runtime at `/opt/dicomweb-proxy/config/config.jsonc`.

#### Update Flow

**Endpoint:** `POST /config/update` (handled by `ConfigHandler.getUpdateConfigHandler()`)

1. **Validation:** New config is validated before applying (`src/config/config.ts:91`)

2. **Automatic Backup:** YES - Always created before updating
   - Format: `config.jsonc.backup-YYYY-MM-DDTHH-MM-SS-mmmZ`
   - Location: Same directory as config file
   - Source: `src/config/config.ts:107-121` (`createConfigBackup()`)
   ```typescript
   const backupPath = `${this.configPath}.backup-${timestamp}`;
   copyFileSync(this.configPath, backupPath);
   ```

3. **Write Operation:** Config written as formatted JSON (not JSONC)
   ```typescript
   const configJson = JSON.stringify(config, null, 2);
   writeFileSync(this.configPath, configJson, 'utf-8');
   ```

4. **Service Restart:** By default, the service restarts automatically after config update
   - Grace period: 1000ms
   - Can be disabled with `restartAfterUpdate: false` parameter

#### Config Endpoints

- `GET /config/current` - Retrieve sanitized current config (sensitive paths masked)
- `POST /config/test` - Validate config without applying
- `POST /config/update` - Apply new configuration with automatic backup
- `POST /config/restart` - Manually restart service

---

## Certificate Management

### During Installation

**Location:** `src/installer.ts:545-615`

#### HTTP SSL Certificates

**Flow:** `installCertificates()` → `installHttpSslCertificates()` → `installCertificateSet()`

1. **Check Enabled:** Only processes if `config.ssl.enabled === true`

2. **Source Validation:** Verifies certificate files exist at paths specified in config
   - Reads from: `config.ssl.certPath` and `config.ssl.keyPath`
   - Validates PEM format (checks for BEGIN CERTIFICATE/PRIVATE KEY markers)

3. **Backup Existing:** If certificates already exist at target location, creates timestamped backup:
   ```
   /opt/dicomweb-proxy/certs/server.crt.backup.YYYY-MM-DDTHH-MM-SS-mmmZ
   /opt/dicomweb-proxy/certs/server.key.backup.YYYY-MM-DDTHH-MM-SS-mmmZ
   ```

4. **Copy to Standard Location:**
   - Certificate → `/opt/dicomweb-proxy/certs/server.crt` (permissions: 644)
   - Private Key → `/opt/dicomweb-proxy/certs/server.key` (permissions: 600)

5. **Post-Copy Validation:** Validates PEM format after copying

6. **Update Config:** Config file is updated to reference standard paths (line 617-658)

#### DIMSE TLS Certificates

**Flow:** `installCertificates()` → `installDimseTlsCertificates()` → `installCertificateSet()`

1. **Check Enabled:** Only processes if:
   - `config.proxyMode === 'dimse'` AND
   - `config.dimseProxySettings.proxyServer.securityOptions` exists

2. **Source Files:**
   - `cert`: Certificate file
   - `key`: Private key file
   - `ca`: CA certificate (optional)

3. **Target Location:** `/opt/dicomweb-proxy/certs/dimse/`
   - `server.crt` (permissions: 644)
   - `server.key` (permissions: 600)
   - `ca.crt` (permissions: 644, if provided)

4. **Backup Behavior:** Same as HTTP SSL - timestamped backups created

### Via Web Interface

**Location:** `src/handlers/config.ts:151-208` (`getUploadCertHandler()`)

**Endpoint:** `POST /config/upload-cert`

#### Upload Flow

1. **File Upload:** Accepts multipart form data with certificate and key files

2. **Determine Paths:**
   - Resolves config directory from current config path
   - Creates `certs` subdirectory if needed
   - Target paths based on `certType` parameter (default: 'ssl')

3. **Write Files:**
   ```typescript
   const certPath = join(certsDir, `${certType || 'ssl'}.crt`);
   const keyPath = join(certsDir, `${certType || 'ssl'}.key`);
   writeFileSync(certPath, cert);
   writeFileSync(keyPath, key);
   ```

4. **Update Config:** Automatically updates config with new certificate paths

5. **NO Automatic Backup:** Certificate files are directly overwritten
   - ⚠️ **Warning:** Unlike config updates, certificate uploads via web UI do NOT create backups
   - Previous certificates are lost unless manually backed up

6. **Restart Required:** Service must be manually restarted for new certificates to take effect

---

## Backup Behavior Summary

### What Gets Backed Up Automatically

| Item | Installer | Web Config Update | Web Cert Upload |
|------|-----------|-------------------|-----------------|
| Config File | ✅ Yes | ✅ Yes | ❌ No |
| Binary File | ✅ Yes | N/A | N/A |
| HTTP SSL Certs | ✅ Yes | N/A | ❌ No |
| DIMSE TLS Certs | ✅ Yes | N/A | ❌ No |

### Backup Naming Conventions

- **Installer backups:** `filename.backup.YYYY-MM-DDTHH-MM-SS-mmmZ`
- **Web config backups:** `filename.backup-YYYY-MM-DDTHH-MM-SS-mmmZ`
  - Note the hyphen difference: `.backup.` vs `.backup-`

### Recovery

To restore from a backup:

```bash
# List available backups
ls -la /opt/dicomweb-proxy/config/*.backup*

# Restore a config backup
sudo cp /opt/dicomweb-proxy/config/config.jsonc.backup-2024-01-15T10-30-00-000Z \
        /opt/dicomweb-proxy/config/config.jsonc

# Restart service
sudo systemctl restart dicomweb-proxy
```

---

## Configuration File Locations

### Development/Pre-Install

- Source config: `./config/config.jsonc` (relative to installer working directory)

### Post-Install Production

- Active config: `/opt/dicomweb-proxy/config/config.jsonc`
- Config backups: `/opt/dicomweb-proxy/config/config.jsonc.backup*`
- HTTP SSL certs: `/opt/dicomweb-proxy/certs/server.{crt,key}`
- DIMSE TLS certs: `/opt/dicomweb-proxy/certs/dimse/server.{crt,key,ca.crt}`
- Cert backups: `/opt/dicomweb-proxy/certs/**/*.backup.*`

### Config Search Order

**Location:** `src/config/config.ts:17-44` (`findConfigFile()`)

The application searches for config in this order:

1. Path passed to ConfigManager constructor
2. Directory of the executable:
   - `{executableDir}/config.jsonc`
   - `{executableDir}/config.json`
   - `{executableDir}/config/config.jsonc`
   - `{executableDir}/config/config.json`
3. Current working directory:
   - `./config.jsonc`
   - `./config.json`
   - `./config/config.jsonc`
   - `./config/config.json`
4. Absolute current working directory:
   - Same patterns as #3 but resolved with `process.cwd()`

---

## Best Practices

### Before Reinstalling

1. **Backup your current config:**
   ```bash
   sudo cp /opt/dicomweb-proxy/config/config.jsonc \
           /opt/dicomweb-proxy/config/config.jsonc.manual-backup
   ```

2. **Review web interface changes:** Any changes made via the dashboard will be lost

3. **Merge configurations:** If you want to preserve web changes, merge them into `./config/config.jsonc` before reinstalling

### Before Uploading Certificates

1. **Manual backup recommended:**
   ```bash
   sudo cp /opt/dicomweb-proxy/certs/server.crt \
           /opt/dicomweb-proxy/certs/server.crt.backup
   sudo cp /opt/dicomweb-proxy/certs/server.key \
           /opt/dicomweb-proxy/certs/server.key.backup
   ```

2. **Test certificates first:** Use `POST /config/test` endpoint before applying

### Configuration Change Strategy

**For temporary/testing changes:**
- Use web interface (backed up automatically)

**For permanent/version-controlled changes:**
- Update `./config/config.jsonc` in source
- Reinstall or manually sync to production

---

## Edge Cases and Gotchas

1. **Installer Overwrites Web Changes:** Running `install-rhel` again will replace any config changes made via web interface with the config from `./config/config.jsonc`

2. **Certificate Paths Updated:** After installation, config certificate paths are rewritten to standard locations, even if you specified different paths initially

3. **Cert Upload No Backup:** Uploading certificates via web interface does NOT create backups automatically - previous certificates are lost

4. **JSONC to JSON:** Web interface saves config as pure JSON (no comments), even if original was JSONC

5. **Service Restart Required:** Certificate changes via web upload require manual service restart

6. **Multiple Backups Accumulate:** Each operation creates a new backup file - consider periodic cleanup of old backups

---

## Related Files

- `src/installer.ts` - Installation and certificate management
- `src/config/config.ts` - ConfigManager class with backup logic
- `src/handlers/config.ts` - Web API handlers for config/cert updates
- `src/server/dashboard.ts` - Web UI for configuration management
