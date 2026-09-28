import type { PulseConvertDesktopAPI } from '../../../electron/types';

declare global {
  interface Window {
    pulseConvertDesktop: PulseConvertDesktopAPI;
  }
}

export const pc = window.pulseConvertDesktop;

export type * from '../../../electron/types';
