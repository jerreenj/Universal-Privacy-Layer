import React from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";

/**
 * ChunkErrorBoundary — catches lazy-load failures and "ChunkLoadError"
 * errors thrown by `lazy()` imports.
 *
 * Why this exists:
 *   React.lazy() + Suspense silently leaves the page blank if the chunk
 *   referenced by `lazy(() => import(...))` fails to fetch (network
 *   error, 404 after a hash mismatch, or the service worker serving a
 *   stale HTML whose referenced chunks no longer exist). Without an
 *   error boundary, the suspended fallback spins forever.
 *
 *   This boundary catches that exception and renders a small "Refresh
 *   to update" panel with one button. The button forces a hard reload
 *   which wipes the service-worker'd chunks from the browser cache and
 *   loads the new build.
 *
 * The `feature` prop is the lazy-loaded component (NOT a rendered
 * element); wrap it as `<ChunkErrorBoundary feature={Component} />`.
 */
export class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log to console so devs can debug network/console issues.
    // eslint-disable-next-line no-console
    console.error("[ChunkErrorBoundary] lazy chunk failed:", error, info);
  }

  handleRefresh = () => {
    // query param forces the browser to bypass any cache & SW and
    // re-fetch the actual server-rendered page.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("__r", String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  render() {
    if (this.state.error) {
      const { featureName } = this.props;
      return (
        <div
          data-testid="chunk-error"
          className="bg-yellow-500/10 border border-yellow-500/30 p-4 md:p-6 text-yellow-200 space-y-3"
        >
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="w-5 h-5" />
            This page didn't load the latest bundle
          </div>
          <p className="text-sm text-yellow-200/80">
            The <span className="font-mono">{featureName || "feature"}</span>{" "}
            component's lazy-loaded chunk is missing or stale (this happens if
            you had the site open across a redeploy). Hit Refresh to fetch the
            newest build.
          </p>
          <button
            onClick={this.handleRefresh}
            className="inline-flex items-center gap-2 px-4 py-2 border border-yellow-500/50 hover:bg-yellow-500 hover:text-black text-sm font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Refresh to latest build
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * SafeSuspense — wraps a lazy component in both Suspense (loading
 * spinner) and a ChunkErrorBoundary (chunk-load error). Use this in
 * place of raw <Suspense fallback={...}> whenever you render a
 * lazy() component.
 *
 * Props:
 *   - children: the lazy component (NOT a rendered ReactNode; pass
 *     `<MyLazy />`).
 *   - fallback: what to show while the chunk is loading (spinner).
 *   - featureName: human-readable label passed to the error UI so users
 *     see WHICH page failed to load (e.g. "sui-encrypted-receipts").
 */
export function SafeSuspense({ children, fallback, featureName }) {
  return (
    <ChunkErrorBoundary featureName={featureName}>
      <React.Suspense fallback={fallback}>{children}</React.Suspense>
    </ChunkErrorBoundary>
  );
}
