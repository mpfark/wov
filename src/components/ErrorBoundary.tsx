import { Component, type ErrorInfo, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') window.location.reload();
  };

  handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined') window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center parchment-bg p-6">
        <div className="max-w-md w-full rounded-lg border border-border bg-card/80 backdrop-blur p-6 shadow-lg text-center">
          <h1 className="font-display text-2xl text-primary text-glow mb-2">The realm shudders…</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Something unexpected went wrong. Your progress is safe on the server — reload to keep playing.
          </p>
          <div className="text-xs text-muted-foreground/70 mb-6 font-mono break-words">
            {this.state.error.message}
          </div>
          <div className="flex gap-2 justify-center">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition"
            >
              Reload
            </button>
            <button
              onClick={this.handleSignOut}
              className="px-4 py-2 rounded-md border border-border hover:bg-muted transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
