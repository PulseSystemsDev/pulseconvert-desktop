import type { SelectedInput } from './bridge';

let pending: SelectedInput[] = [];

export function setPendingInputs(inputs: SelectedInput[]): void {
  pending = inputs;
}

export function takePendingInputs(): SelectedInput[] {
  const taken = pending;
  pending = [];
  return taken;
}
