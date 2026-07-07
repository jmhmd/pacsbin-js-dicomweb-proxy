# Running on Windows (informational)

The proxy currently targets Linux (RHEL) with a self-contained binary under
systemd. Windows is **not built or supported yet**, but this document explains
what a Windows deployment would look like so the trade-off can be evaluated —
especially for hospital IT teams that prefer Windows VMs.

## How a long-running service works on Windows

The Windows equivalent of a systemd service is a **Windows Service**, managed by
the Service Control Manager (SCM). Unlike Linux, a plain executable can't simply
"be" a service — the SCM expects a program that implements a service control
interface. The pragmatic solution is a small, mature **wrapper**:

- **NSSM** (Non-Sucking Service Manager) — point it at the binary; it handles
  SCM registration, automatic restart-on-crash (the equivalent of systemd's
  `Restart=always`, which this app relies on), and redirecting stdout/stderr to
  rotating log files.
- **WinSW** — an XML-configured alternative with the same capabilities.

`sc.exe` / `New-Service` can register a service but won't supervise a
non-service-aware executable well on their own, so a wrapper is the route.

## Install & management

- No `dnf` / `firewall-cmd` / `setcap` / `chcon`. Instead: copy files to
  `C:\Program Files\dicomweb-proxy\` (config/data under `C:\ProgramData\`),
  register the service (`nssm install dicomweb-proxy ...`), and open the port in
  **Windows Defender Firewall** (`netsh advfirewall firewall add rule ...`).
- Binding privileged ports (443) does **not** need special capabilities the way
  Linux needs `setcap` — an Administrator-installed service can bind them.
- Day-to-day management is `services.msc` (GUI), `Get-Service` /
  `Restart-Service` (PowerShell), or `nssm restart` — arguably more familiar for
  Windows admins than journald/systemctl.

## Logging

Windows apps log to the **Windows Event Log** (Event Viewer) or to plain files.
This app logs to stdout (pino) plus the in-memory dashboard buffer. The path of
least resistance is to have the NSSM/WinSW wrapper redirect stdout/stderr to
rotating files (both support this natively), giving admins
`C:\ProgramData\dicomweb-proxy\logs\*.log`. That actually resolves the "where
are the logs" question more directly than the Linux journald-only story.

## Build

Bun can produce a standalone Windows executable:

```
bun build ./src/index.ts --compile --target=bun-windows-x64 --outfile dicomweb-proxy.exe
```

so the app itself should run. The real work is not the binary — it's a parallel
installer path (the current `src/installer.ts` is RHEL-only and shells out to
Linux tools) plus bundling NSSM/WinSW and a PowerShell install script.

## Recommendation

- **Effort/risk:** a native Windows service is moderate effort (second installer
  path + wrapper bundling + docs), low technical risk given NSSM's maturity.
- **Lowest-effort option:** run the existing Linux container on the Windows VM
  via Docker Desktop / WSL2 — reuses the Linux artifact entirely but adds a
  Docker dependency IT must accept.
- If Windows demand materializes, the **NSSM-wrapped native service** is the best
  fit for hospital IT comfort (native service console + file logs), unless the
  site already runs containers.

The Linux-first work already done does not paint us into a corner: the process
exits cleanly for a supervisor to relaunch (it detects when no supervisor is
present), and a file-logging option is straightforward to add.
