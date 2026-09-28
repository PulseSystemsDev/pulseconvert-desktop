import { useState, type ReactNode } from 'react';
import { FolderOpen, UploadCloud } from 'lucide-react';
import { pc, type PickerMode, type SelectedInput } from '../lib/bridge';
import { cx } from '../lib/format';
import { Button } from './ui';

export function Dropzone({
  onSelect,
  multiple = false,
  modes = ['archives'],
  title = 'Drop files here',
  hint,
  accept,
  compact,
  children,
}: {
  onSelect: (inputs: SelectedInput[]) => void;
  multiple?: boolean;
  modes?: PickerMode[];
  title?: string;
  hint?: ReactNode;
  accept?: (input: SelectedInput) => boolean;
  compact?: boolean;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);

  const handle = (inputs: SelectedInput[]) => {
    const usable = accept ? inputs.filter(accept) : inputs;
    if (usable.length) onSelect(multiple ? usable : usable.slice(0, 1));
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOver(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length) handle(await pc.approveDroppedFiles(files));
      }}
      className={cx(
        'group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors',
        compact ? 'px-5 py-6' : 'px-6 py-10',
        over ? 'border-accent-orange bg-accent-orange/[0.06]' : 'border-border hover:border-border-strong',
      )}
    >
      <div className={cx('mb-3 flex h-11 w-11 items-center justify-center rounded-xl border transition-colors', over ? 'border-accent-orange/40 bg-accent-orange-dim text-accent-orange' : 'border-border bg-bg-elevated text-slate-400')}>
        <UploadCloud className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-white">{over ? 'Drop to add' : title}</p>
      {hint && <p className="mt-1 max-w-[46ch] text-xs leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {modes.includes('archives') && (
          <Button size="sm" icon={UploadCloud} onClick={async () => handle(await pc.pickInputs('archives', multiple))}>
            Choose {multiple ? 'files' : 'a file'}
          </Button>
        )}
        {modes.includes('zip') && (
          <Button size="sm" icon={UploadCloud} onClick={async () => handle(await pc.pickInputs('zip', multiple))}>
            Choose a .zip
          </Button>
        )}
        {modes.includes('folder') && (
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={async () => handle(await pc.pickInputs('folder', multiple))}>
            Choose a folder
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
