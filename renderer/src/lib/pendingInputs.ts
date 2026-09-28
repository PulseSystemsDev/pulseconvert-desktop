import type { SelectedInput } from './bridge';

// Files dropped onto the window outside a specific drop zone are parked here and picked up by
// the Convert page when it mounts.
let pending: SelectedInput[] = [];

export function setPendingInputs(inputs: SelectedInput[]): void {
  pending = inputs;
}

export function takePendingInputs(): SelectedInput[] {
  const taken = pending;
  pending = [];
  return taken;
}
