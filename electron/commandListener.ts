import log from 'electron-log';
import { apiBase } from './configStore';
import { desktopFetchJson, getValidAccessToken } from './apiClient';

export interface DeviceCommand {
  id: string;
  device_id: string;
  type: string;
  payload: string | null;
}

type CommandHandler = (command: DeviceCommand) => Promise<{ ok: boolean; result?: unknown; error?: string }>;

export class CommandListener {
  private deviceId: string;
  private handler: CommandHandler;
  private stopped = false;
  private abortController: AbortController | null = null;
  private generation = 0;

  constructor(deviceId: string, handler: CommandHandler) {
    this.deviceId = deviceId;
    this.handler = handler;
  }

  start(): void {
    this.stopped = false;
    const generation = ++this.generation;
    void this.loop(generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.abortController?.abort();
  }

  private async loop(generation: number): Promise<void> {
    while (!this.stopped && generation === this.generation) {
      try {
        await this.connectOnce(generation);
      } catch (err) {
        if (!this.stopped && generation === this.generation) {
          log.warn('[commandListener] connection dropped, reconnecting in 5s', err);
        }
      }
      if (this.stopped || generation !== this.generation) return;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  private async connectOnce(generation: number): Promise<void> {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return;
    }

    this.abortController = new AbortController();
    const url = `${apiBase()}/api/desktop/devices/${this.deviceId}/events`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: this.abortController.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Could not connect to command stream (${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (!this.stopped && generation === this.generation) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
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
