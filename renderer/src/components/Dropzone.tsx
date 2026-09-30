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
        'group relative flex flex-col items-center justify-center rounded-[5px] border border-dashed text-center transition-colors',
        compact ? 'px-4 py-4' : 'px-5 py-8',
        over ? 'border-accent-orange bg-accent-orange/[0.05]' : 'border-border-strong hover:border-zinc-500',
      )}
    >
      <p className="text-[13px] font-medium text-zinc-200">{over ? 'Drop to add' : title}</p>
      {hint && <p className="mt-0.5 max-w-[56ch] text-[12px] leading-relaxed text-zinc-500">{hint}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
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
