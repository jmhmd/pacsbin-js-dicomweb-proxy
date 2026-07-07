# Troubleshooting

A field guide for diagnosing the Pacsbin DICOMweb proxy without deep DICOM
knowledge. Most problems fall into a handful of buckets: the service won't
start, it can't reach the PACS, TLS/cert issues, or the uploader gets CORS /
mixed-content errors.

## First stop: is it running and healthy?

```bash
systemctl status dicomweb-proxy          # running? crash-looping?
curl -s http://localhost:3006/health     # detailed health JSON
journalctl -u dicomweb-proxy -f          # live logs
```

`GET /health` reports version, uptime, memory (`rssMB`), cache hit rate, the
DIMSE queue depth / in-flight count, and the result of the last connectivity
check (`lastPeerEcho`). This is the fastest way to see "why is it slow/stuck"
without shell access — the dashboard **Status** tab shows the same data.

> Logs go to the **systemd journal**, not to a file. The `logs/` directory under
> the install dir is not used. Use `journalctl -u dicomweb-proxy` or the
> dashboard **Logs** tab / `GET /logs/download`.

## The service won't start

- **Config validation failed** — the journal prints exactly which field is
  wrong (`Configuration validation failed: …`). Fix it in
  `/opt/dicomweb-proxy/config/config.jsonc` and `systemctl restart dicomweb-proxy`.
- **"dashboardAuth.password must be changed from the default 'admin'"** — you
  enabled dashboard auth but left the default password. Set a real password.
- **Port already in use / permission denied binding 443** — another service
  owns the port, or the binary lost its `CAP_NET_BIND_SERVICE` capability
  (re-run `install-rhel`, which applies it). Check `ss -ltnp | grep <port>`.
- **SSL enabled but cert files missing** — the journal logs the exact paths it
  looked for. Ensure the cert/key exist and paths are absolute.

## Can't reach the PACS (queries/retrievals fail or hang)

- **Run a C-ECHO** from the dashboard (or `POST /dimse/echo {"peerIndex":0}`).
  Success confirms network + AE-title configuration; failure points at
  firewall, wrong host/port, or an AE title the PACS doesn't recognize.
- **Timeouts** — a request that returns a DIMSE timeout means the PACS accepted
  the association but never completed it. Confirm the peer AE title, and that
  the PACS has the proxy's AE title / IP whitelisted for C-MOVE.
- **Incomplete series (last image missing)** — lower
  `dimseProxySettings.maxConcurrentConnections` to 4 or less (some PACS drop the
  final image at higher concurrency).
- **`503 DIMSE proxy busy`** — the request queue is full (`maxQueueLength`). The
  proxy is applying backpressure; check whether the PACS is slow or unreachable.

## TLS / certificate problems

- **DIMSE TLS mismatch** — the journal logs `TLS MISMATCH DETECTED` when a peer
  connects with TLS to a non-TLS listener (or vice versa). Align the
  `securityOptions` TLS setting on both sides. See
  [DIMSE-TLS-Configuration-Guide.md](DIMSE-TLS-Configuration-Guide.md).
- **HTTPS cert not loading** — paths must be absolute; the installer normalizes
  them to `/opt/dicomweb-proxy/certs/`.

## Uploader errors (CORS / mixed content)

- **Mixed content** — the uploader is served over HTTPS but the proxy is HTTP.
  Enable `ssl` on the proxy (have certs ready before install).
- **CORS blocked** — set `cors.origin` to your uploader's origin. Note: with
  `"origin": ["*"]` the proxy will not send credentials headers by design; use an
  explicit origin allowlist if the uploader needs credentialed requests.

## Config changes and restarts

- The installer and the dashboard both read/write the **same** file:
  `/opt/dicomweb-proxy/config/config.jsonc`. Comments are preserved on edits.
- A config update or `POST /config/restart` exits the process and relies on
  systemd to relaunch it. If you run the binary by hand (no supervisor), it will
  log a warning and exit without restarting — start it again manually.
- Every config change writes a timestamped `.backup-*` next to the config so you
  can roll back.

## Updating

Use the update flow in [rhel/README.md](../rhel/README.md) (or
`dicomweb-proxy update` once release artifacts are published). Updates back up
the current binary and config, swap in the new binary, restart, and run a
post-update health check.
