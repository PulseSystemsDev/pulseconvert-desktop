# Pulse Convert Desktop

Desktop client for [Pulse Convert](https://convert.pulsesystems.dev) - runs the conversion
pipeline on your own machine instead of PulseConvert's server.

## Status: Phase A (device sign-in only)

This is the first phase of a larger plan (see the project's own planning notes). Right now this
app does exactly one thing: sign in via Pulse Accounts' device-code flow (RFC 8628) and hold a
securely-stored (OS-keychain-encrypted, `electron.safeStorage`) access/refresh token pair,
auto-refreshed in the background. It does not convert anything yet - the local conversion
pipeline, the gta5mods resolve/catalog-dedup API call, dashboard remote commands, and auto-deploy
are later phases.

## Development

```
npm install
npm run dev
```

`npm run dev` builds the TypeScript main/preload processes (via `tsup`) and launches Electron.

By default this points at production Pulse Accounts (`https://accounts.pulsesystems.dev`) and the
production `pulseconvert-desktop` OIDC client. To point at a local Pulse Accounts dev instance
instead, set before running:

```
PULSE_ACCOUNTS_ISSUER=http://localhost:8090
```

## Architecture

- `electron/main.ts` - app lifecycle, window creation, IPC handlers.
- `electron/authManager.ts` - the sign-in state machine (start/poll/refresh/sign-out).
- `electron/deviceAuth.ts` - low-level RFC 8628 HTTP calls against Pulse Accounts (`/device/auth`,
  `/token`). No client secret - this app is registered as a public OIDC client.
- `electron/tokenStore.ts` - encrypted token persistence via `safeStorage`.
- `electron/configStore.ts` - non-secret settings (issuer URL, client id, API base URL) via
  `electron-store`.
- `electron/preload.ts` - exposes a narrow, typed `window.pulseConvertDesktop` API to the renderer
  via `contextBridge` (no direct Node/Electron access from the UI).
- `renderer/` - plain HTML/CSS/JS UI, no framework (matches the rest of the Pulse ecosystem's
  preference for framework-free UI where the surface is this small).

Sibling project: `d:\Desktop\PulseMDT\desktop` (`pulsemdt-desktop`) is the *unrelated* PulseMDT CAD
desktop client - this app's tooling (`tsup`, `electron-builder`) deliberately mirrors it for
consistency, but the two are otherwise independent.
