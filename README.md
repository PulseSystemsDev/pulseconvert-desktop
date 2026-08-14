# Pulse Convert Desktop

Pulse Convert Desktop is the local workstation companion for
[Pulse Convert](https://convert.pulsesystems.dev). It converts GTA V mods, optimizes existing
FiveM resources with the machine's native tools, and can deploy completed resources locally or
over SFTP. The packaged app currently targets 64-bit Windows because the bundled RPF processor is
a Windows binary.

## What it does

- Signs in through Pulse Accounts using the OAuth device-code flow.
- Converts supported mod links with preserve or performance processing profiles.
- Builds add-on or replacement vehicle resources.
- Optimizes resource archives, standalone stream files, and resource folders.
- Supports props, vehicles, clothing, and texture-focused optimization plans.
- Runs preflight checks against the configured RPF, Blender, and 7-Zip tools.
- Produces a new ZIP and a measured run report instead of overwriting source content.
- Can reveal an output locally, deploy to a local resources folder, or deploy through SFTP.
- Receives queued conversion and optimization commands from the Pulse Convert dashboard.

The renderer is a framework-free HTML, CSS, and JavaScript workspace. Electron's preload bridge
keeps Node and filesystem access outside the renderer.

## Current boundaries

- Link conversion runs the local vehicle pipeline; the manual Optimize workspace handles props,
  clothing, and texture resources.
- Optimize changes directly accessible stream assets. Nested ZIP, RAR, 7z, OIV, and RPF
  containers are preserved byte-for-byte; extract a nested-only resource before optimizing it.
- Tool readiness verifies the configured executables. It does not yet verify the Sollumz operator
  inside Blender, and SFTP deployment does not yet support host-key fingerprint pinning.

## Development

```powershell
npm install
npm run dev
```

Useful checks:

```powershell
npm run typecheck
npm run build:ts
npm run build:dir
```

By default, the app uses production Pulse Accounts and the production Pulse Convert API. To use
a local Pulse Accounts instance, set this before launch:

```powershell
$env:PULSE_ACCOUNTS_ISSUER = "http://localhost:8090"
npm run dev
```

## Architecture

- `electron/main.ts`: app lifecycle, BrowserWindow creation, native dialogs, and IPC handlers.
- `electron/authManager.ts`: device sign-in, refresh, and sign-out state machine.
- `electron/convertFlow.ts`: linked-mod resolution and conversion orchestration.
- `electron/localConvert.ts`: local archive, RPF, metadata, texture, and resource build pipeline.
- `electron/optimizeFlow.ts`: non-destructive local optimization, remote-job orchestration, and report generation.
- `electron/configStore.ts`: non-secret app, tool, output, and deployment settings.
- `electron/tokenStore.ts`: access and refresh token persistence protected by `safeStorage`.
- `electron/preload.ts`: narrow typed `window.pulseConvertDesktop` renderer bridge.
- `renderer/`: the process-led desktop workspace and its local run history.

The sibling `desktop` project is the unrelated PulseMDT CAD client. The applications share build
conventions, but their product behavior and data are separate.
