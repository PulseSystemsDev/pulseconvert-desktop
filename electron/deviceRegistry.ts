import os from 'os';
import crypto from 'crypto';
import log from 'electron-log';
import config from './configStore';
import { desktopFetchJson } from './apiClient';

export function getOrCreateDeviceId(): string {
  const existing = config.get('deviceId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  config.set('deviceId', id);
  return id;
}

export async function registerThisDevice(): Promise<void> {
  const deviceId = getOrCreateDeviceId();
  try {
    await desktopFetchJson('/api/desktop/devices/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, name: os.hostname(), platform: process.platform }),
    });
  } catch (err) {
    log.warn('[deviceRegistry] could not register this device with the server', err);
  }
}
