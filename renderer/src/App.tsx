import { useEffect, useRef, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { pc, type Task } from './lib/bridge';
import { AccountProvider } from './lib/account';
import { useAuth, useSettings, useTasks } from './lib/hooks';
import { setPendingInputs } from './lib/pendingInputs';
import { RouterProvider, useRouter, type Route } from './lib/router';
import { ToastProvider, useToast } from './lib/toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { Welcome } from './components/Welcome';
import { isActive } from './components/taskMeta';
import { SignIn } from './pages/SignIn';
import { Home } from './pages/Home';
import { Convert } from './pages/Convert';
import { Optimize } from './pages/Optimize';
import { Fix } from './pages/Fix';
import { Catalog } from './pages/Catalog';
import { Gallery } from './pages/Gallery';
import { Jobs } from './pages/Jobs';
import { Queue } from './pages/Queue';
import { Stats } from './pages/Stats';
import { Tools } from './pages/Tools';
import { Deploy } from './pages/Deploy';
import { Settings } from './pages/Settings';

function useCompletionToasts(tasks: Task[]) {
  const toast = useToast();
  const { navigate } = useRouter();
  const seen = useRef<Map<string, Task['phase']> | null>(null);
  useEffect(() => {
    const previous = seen.current;
    const next = new Map(tasks.map((task) => [task.id, task.phase]));
    seen.current = next;
    if (!previous) return;
    for (const task of tasks) {
      const before = previous.get(task.id);
      if (!before || before === task.phase || !document.hasFocus()) continue;
      if (task.phase === 'done' && task.kind !== 'map-inspect') {
        toast.success(`${task.title} is ready`, task.deploy?.deployed ? `Deployed to ${task.deploy.destination}` : task.outputPath ? 'Saved to your output folder.' : undefined, task.outputPath ? { label: 'Show in folder', onClick: () => pc.showInFolder(task.outputPath!) } : { label: 'Open Jobs', onClick: () => navigate('jobs') });
      } else if (task.phase === 'failed') {
        toast.error(`${task.title} failed`, task.error ?? undefined);
      }
    }
  }, [tasks, toast, navigate]);
}

function Page({ route, tasks }: { route: Route; tasks: Task[] }) {
  switch (route) {
    case 'home':
      return <Home tasks={tasks} />;
    case 'convert':
      return <Convert />;
    case 'optimize':
      return <Optimize />;
    case 'fix':
      return <Fix />;
    case 'catalog':
      return <Catalog />;
    case 'gallery':
      return <Gallery />;
    case 'jobs':
      return <Jobs tasks={tasks} />;
    case 'queue':
      return <Queue />;
    case 'stats':
      return <Stats />;
    case 'tools':
      return <Tools tasks={tasks} />;
    case 'deploy':
      return <Deploy />;
    case 'settings':
      return <Settings />;
  }
}

function Workspace() {
  const tasks = useTasks();
  const { route, params, navigate } = useRouter();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const scrollRef = useRef<HTMLElement>(null);
  const [settings, setSettings] = useSettings();
  useCompletionToasts(tasks);

  useEffect(() => pc.onNavigate((target) => navigate(target === 'activity' ? 'jobs' : (target as Route))), [navigate]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [route, params]);

  const pageHandlesDrops = ['convert', 'optimize', 'fix', 'tools'].includes(route);

  return (
    <div
      className="flex h-full flex-col"
      onDragEnter={(event) => {
        if (pageHandlesDrops || !event.dataTransfer.types.includes('Files')) return;
        depth.current += 1;
        setDragging(true);
      }}
      onDragLeave={() => {
        if (pageHandlesDrops) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={async (event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (pageHandlesDrops) return;
        const inputs = await pc.approveDroppedFiles(Array.from(event.dataTransfer.files));
        if (inputs.length) {
          setPendingInputs(inputs);
          navigate('convert', { dropped: String(Date.now()) });
        }
      }}
    >
      <TitleBar tasks={tasks} signedIn />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeCount={tasks.filter(isActive).length} />
        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-8 pb-12 pt-8">
          <div key={`${route}-${params.dropped ?? ''}`} className="animate-fade-in">
            <ErrorBoundary>
              <Page route={route} tasks={tasks} />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      {settings && !settings.onboarded && <Welcome settings={settings} onDone={setSettings} />}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 top-11 z-[70] flex animate-fade-in items-center justify-center bg-bg-base/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-accent-orange bg-accent-orange/[0.06] px-16 py-12 text-center">
            <UploadCloud className="mx-auto h-8 w-8 text-accent-orange" />
            <p className="mt-3 text-lg font-bold text-white">Drop to convert</p>
            <p className="mt-1 text-sm text-slate-400">Archives, folders, or a .txt of links</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  const status = useAuth();

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <RouterProvider>
        {status.state === 'signed-in' ? (
          <AccountProvider>
            <Workspace />
          </AccountProvider>
        ) : (
          <div className="flex h-full flex-col">
            <TitleBar tasks={[]} signedIn={false} />
            <div className="min-h-0 flex-1">
              <SignIn status={status} />
            </div>
          </div>
        )}
      </RouterProvider>
    </ToastProvider>
  );
}
