import React from "react";

/**
 * FeatureErrorBoundary — simple, correct, no gotchas.
 *
 * PREVIOUS BUGS (do not reintroduce):
 *   - v1 returned `this.props.children` even when state.error was set,
 *     causing a re-throw → React unmount → blank screen.
 *   - v2 force-reloaded the page on error → infinite reload loop.
 *   - v3 had window-level listeners that hijacked unrelated errors.
 *
 * This version has exactly TWO render branches. No fall-through.
 * On error: show a simple panel with "Back" + "Reload" buttons.
 * On normal: render children. That's it.
 */
export class FeatureErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[FeatureErrorBoundary]", error, errorInfo);
  }

  handleBack = () => {
    // Clear the hash and go back to dashboard. We use history.back()
    // because setPage pushed a state entry when navigating here.
    try {
      window.history.pushState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      window.location.href = "/";
    }
  };

  handleReload = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error
        ? (this.state.error.message || String(this.state.error)).slice(0, 200)
        : "Unknown error";
      return (
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/30 p-4 text-sm">
            <p className="text-red-300 font-semibold mb-2">Something went wrong.</p>
            <p className="text-xs text-red-200/60 font-mono break-all">{msg}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={this.handleBack}
              className="flex-1 px-4 py-2.5 border border-white/30 hover:border-white hover:bg-white hover:text-black text-sm font-medium transition-colors"
            >
              ← Back to Dashboard
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2.5 border border-white/20 hover:border-white/40 text-sm text-white/60 hover:text-white transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
