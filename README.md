# Pulse Convert Desktop

The desktop app for [Pulse Convert](https://convert.pulsesystems.dev), for Windows and Linux. It does
everything the website does, plus the things a browser can't: it keeps working in the background,
drops finished resources straight into your output folder, and deploys them to a local server or
over SFTP.

## Features

- **Convert** vehicles, props, maps, EUP/clothing, weapons, peds and animation packs from a
  gta5-mods.com / MediaFire / ShareMods link, an archive, or a whole folder. Add several items to
  build a pack, or drop in a `.txt` with one link per line.
- **Optimize** vehicles, props, clothing and textures (including a standalone `.ytd`).
- **Fix** an existing resource's meta files without renaming anything or touching textures.
- **Catalog** of vehicles, weapon animations, maps, peds and EUP with search, sorting,
  favorites, instant prebuilt downloads and a 3D preview.
- **Jobs**: every job from the app *and* the website, with live progress, queue position, the
  fix log, 3D preview, download, re-run, delete, "works in game" confirmation and gallery
  screenshot submission.
- **Server queue**, **live stats** and the **community gallery**.
- **Tools**: collision checker, map & MLO inspector, siren resource builder.
- **Deploy** to a local resources folder or over SFTP (with host key pinning and a connection
  test), automatically after each job or on demand.
- Background work that survives restarts: once a job reaches the server, closing the app is safe
  and it picks back up on the next launch. Desktop notifications, Discord DM toggle, dashboard
  commands, and auto-updates.

## Development

```bash
npm install
npm run dev        # build everything and launch
npm run demo       # launch against a local mock backend (no account needed)
npm run typecheck
```

`npm run demo` starts `scripts/mock-server.js`, a fake Pulse Accounts + Pulse Convert API with
sample data, and runs the app with a throwaway profile. Sign in with the button - it approves
itself after a few seconds.

To point a normal launch at another backend:

```bash
PULSECONVERT_API_URL=http://localhost:3007 PULSE_ACCOUNTS_ISSUER=http://localhost:8090 npm start
```

On Linux, if Electron's sandbox helper isn't set up (common in containers), launch with
`PULSECONVERT_NO_SANDBOX=1 npm start`.

## Building installers

```bash
npm run dist:win     # Windows NSIS installer (run on Windows)
npm run dist:linux   # Linux AppImage + .deb
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds both platforms on their own
runners and attaches them to a draft GitHub release. The AppImage and the Windows install update
themselves from published releases; `.deb` installs update through a new download.

## Architecture

- `electron/main.ts` - window, IPC and lifecycle. `bootstrap.ts` runs first for path overrides.
- `electron/taskManager.ts` - every upload, server job, download and deploy is a task with live
  progress, persisted so interrupted jobs resume after a restart.
- `electron/operations.ts` - the convert / optimize / fix / catalog / tools flows built on tasks.
- `electron/apiProxy.ts` - the renderer never sees the access token; it asks the main process to
  call an allowlisted set of Pulse Convert endpoints.
- `electron/files.ts` - local paths are only accepted from the native picker or a real
  drag-and-drop.
- `electron/secureStore.ts` - tokens and SFTP passwords use the OS keychain via `safeStorage`; on
  Linux without a keychain they fall back to a user-only (0600) file.
- `electron/deploy/` - local folder and SFTP deploy.
- `renderer/` - React + Tailwind UI built with Vite, sharing its types with `electron/types.ts`.
