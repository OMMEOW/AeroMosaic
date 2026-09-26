"use client";

import { Component, type ReactNode } from "react";

/**
 * Per-panel error boundary: one failed chart or table must not blank the
 * page. Shows what failed and offers a retry that remounts the subtree.
 */
export class PanelBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null; key: number }> {
  state = { error: null as Error | null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn(`[panel] ${this.props.label ?? "panel"} failed to render:`, error.message);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-sm text-fg">{this.props.label ?? "This panel"} failed to render</div>
          <div className="num max-w-md text-2xs break-words text-fg-subtle">{this.state.error.message}</div>
          <button
            type="button"
            className="rounded-md border border-line-strong px-2 py-1 text-xs text-fg-muted hover:text-fg"
            onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}
          >
            Retry
          </button>
        </div>
      );
    }
    return <div key={this.state.key} className="contents">{this.props.children}</div>;
  }
}
