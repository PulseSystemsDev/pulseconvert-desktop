import log from 'electron-log';
import config from './configStore';
import { loadTokens } from './tokenStore';
import { desktopFetchJson } from './apiClient';

export interface DeviceCommand {
  id: string;
  device_id: string;
  type: string;
  payload: string | null;
}

type CommandHandler = (command: DeviceCommand) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

/**
 * Consumes the device's own SSE stream (devices/[id]/events) manually rather than via the
 * `EventSource` global - that's a browser/renderer API, not available in the Electron main
 * process, which is where this needs to run to reach fs/child_process for actually executing a
 * command. Node 22's native fetch() gives a real ReadableStream body, which is all SSE actually
 * needs: parse `data: <json>\n\n` frames off the wire by hand. Reconnects with a short backoff on
 * any drop (network blip, server restart, laptop sleep/wake) - this connection is meant to stay
 * open indefinitely for as long as the app runs, per the plan's "agent holds a persistent
 * outbound connection" design.
 */
export class CommandListener {
  private deviceId: string;
  private handler: CommandHandler;
  private stopped = false;
  private abortController: AbortController | null = null;

  constructor(deviceId: string, handler: CommandHandler) {
    this.deviceId = deviceId;
    this.handler = handler;
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce();
      } catch (err) {
        log.warn('[commandListener] connection dropped, reconnecting in 5s', err);
      }
      if (this.stopped) return;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  private async connectOnce(): Promise<void> {
    const tokens = loadTokens();
    if (!tokens) {
      // Not signed in yet - back off longer than the standard reconnect delay so this doesn't
      // spin hot while the sign-in screen is up.
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return;
    }

    this.abortController = new AbortController();
    const url = `${config.get('apiBaseUrl')}/api/desktop/devices/${this.deviceId}/events`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: this.abortController.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Could not connect to command stream (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!this.stopped) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue; // skips ": ping" keepalive comment lines too
          this.handleFrame(line.slice('data: '.length));
        }
      }
    }
  }

  private handleFrame(json: string): void {
    let payload: { commands?: DeviceCommand[] };
    try {
      payload = JSON.parse(json);
    } catch {
      return;
    }
    for (const command of payload.commands ?? []) {
      void this.executeAndReport(command);
    }
  }

  private async executeAndReport(command: DeviceCommand): Promise<void> {
    log.info('[commandListener] executing command', command.type, command.id);
    let outcome: { ok: boolean; result?: unknown; error?: string };
    try {
      outcome = await this.handler(command);
    } catch (err) {
      outcome = { ok: false, error: (err as Error).message || 'Command failed.' };
    }

    try {
      await desktopFetchJson(`/api/desktop/devices/${this.deviceId}/commands/${command.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outcome),
      });
    } catch (err) {
      log.warn('[commandListener] could not report command completion', err);
    }
  }
}
