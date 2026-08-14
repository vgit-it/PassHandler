import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// The alternative to this screen is what 1.0.0 actually shipped: a
// permanently blank window. Production builds have no devtools (see the
// `debug_assertions` gate in lib.rs), so a crash anywhere below this point
// used to be invisible to the user and to us — nothing to report, nothing to
// fix. This turns "blank screen" into "here is the exact error and where it
// happened," readable on the device itself.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Production has no devtools, so this line is unlikely to be seen — the
    // rendered fallback below is what actually reaches the user.
    console.error('Pass Handler crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col gap-3 overflow-auto p-4 text-sm text-slate-200">
        <p className="font-semibold text-red-400">Pass Handler hit an error and could not continue.</p>
        <p className="text-slate-400">
          Nothing was written to the vault. Copy the details below if you are reporting this.
        </p>
        <pre className="whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-xs text-slate-300">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
      </div>
    );
  }
}
