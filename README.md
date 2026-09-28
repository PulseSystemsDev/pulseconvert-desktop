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

To work on the update prompt without publishing a release, run a dev build with
`PULSECONVERT_FAKE_UPDATE=2.1.0 npm run demo`. It fakes an update being found and downloaded.
This is ignored in installed builds.

On Linux, if Electron's sandbox helper isn't set up (common in containers), launch with
`PULSECONVERT_NO_SANDBOX=1 npm start`.

## Building installers

```bash
npm run dist:win     # Windows NSIS installer (run on Windows)
npm run dist:linux   # Linux AppImage + .deb
```

To ship an update, bump `version` in package.json and push a matching tag (`v2.1.0`).
`.github/workflows/release.yml` builds Windows and Linux and publishes the release once both
succeed. The release notes (auto-generated from commits, editable on GitHub) are what users see
in the update popup.

Installed apps check on launch and every 4 hours and download updates in the background. On
launch, a popup shows what's new with **Update now** and **Remind me later** (which asks again
next launch); an update found mid-session shows a toast and a title bar button instead. Nothing
installs without the user choosing to. AppImage and Windows installs update in place; `.deb`
installs update through a new download.

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
