import { useState } from 'react';
import { Hammer } from 'lucide-react';
import { pc, type SelectedInput } from '../lib/bridge';
import { FIX_POINTS } from '../lib/content';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Button, Card, PageHeader, SectionTitle } from '../components/ui';
import { Dropzone } from '../components/Dropzone';
import { SelectedFile } from './Optimize';

export function Fix() {
  const toast = useToast();
  const { navigate } = useRouter();
  const [input, setInput] = useState<SelectedInput | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!input) return;
    setBusy(true);
    const result = await pc.startFix(input.inputPath);
    setBusy(false);
    if (!result.ok) return toast.error('Could not start', result.error);
    setInput(null);
    toast.success('Fix started', undefined, { label: 'Open Jobs', onClick: () => navigate('jobs') });
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader title="Fix a resource" description="Already converted something that won't load right? Re-run the meta validation and fixes only - no renaming and no texture changes." />
      <div className="grid gap-5">
        <Card>
          <SectionTitle title="Resource" />
          {input ? (
            <SelectedFile input={input} onClear={() => setInput(null)} />
          ) : (
            <Dropzone modes={['archives', 'folder']} onSelect={([picked]) => setInput(picked)} title="Drop the resource you want fixed" hint="A .zip (or .rar, .7z, .oiv, .rpf) of the resource, or its folder." />
          )}
          <div className="mt-5 flex justify-end">
            <Button variant="primary" size="lg" icon={Hammer} disabled={!input} loading={busy} onClick={() => void start()}>
              Fix resource
            </Button>
          </div>
        </Card>
        <div className="grid gap-4 md:grid-cols-3">
          {FIX_POINTS.map(({ icon: Icon, title, desc }) => (
            <Card key={title}>
              <Icon className="h-5 w-5 text-accent-orange" />
              <p className="mt-3 text-sm font-semibold text-white">{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{desc}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
