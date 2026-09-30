import { Component, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './ui';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-20 max-w-[460px] text-center">
        <TriangleAlert className="mx-auto h-7 w-7 text-status-warning" />
        <p className="mt-4 text-lg font-bold text-white">This screen hit a problem</p>
        <p className="selectable mt-2 break-words text-[13px] text-zinc-500">{this.state.error.message}</p>
        <p className="mt-2 text-[13px] text-zinc-500">Anything running in the background is unaffected.</p>
        <Button className="mt-6" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
