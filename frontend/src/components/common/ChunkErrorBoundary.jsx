import React from "react";

/**
 * ChunkErrorBoundary — minimal, non-aggressive.
 *
 * HISTORY (so this doesn't regress):
 *   - v1 caught chunk errors and rendered a yellow "Refresh" panel.
 *   - v2 caught chunk errors and force-reloaded the page. BAD: this
 *     created a reload loop that the user saw as a "blank screen."
 *     It also added window-level error/unhandledrejection listeners
 *     that hijacked unrelated errors and force-reloaded on those too.
 *   - v3 (this): DO NOTHING AGGRESSIVE. We keep the boundary so a
 *     crashing feature doesn't take down the whole app, but we NEVER
 *     force a reload, NEVER add global listeners, and NEVER block
 *     children from rendering on a normal mount. If a chunk genuinely
 *     fails to load, we show a small inline "Reload" link (no loop).
 *
 * Net effect: features just show their content. No error panels, no
 * auto-reload, no blank screens.
 */
export class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    // Log only. No reload. No side effects.
    // eslint-disable-next-line no-console
    console.error("[ChunkErrorBoundary]", error);
  }

  render() {
    // Normal path: render the feature.
    if (!this.state.error) return this.props.children;

    // Error path: render a minimal inline panel. NO reload loop.
    // The user can click Reload manually if they want.
    return (
      <div className="py-8 text-center" data-testid="feature-error">
        <p className="text-sm text-white/60 mb-3">This section couldn't be displayed.</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 border border-white/30 hover:border-white text-sm"
        >
          Reload
        </button>
      </div>
    );
  }
}

/**
 * SafeSuspense — Suspense + ChunkErrorBoundary. We keep the wrapper so
 * existing call sites don't break, but it's now just Suspense with a
 * spinner fallback wrapped in the boundary. No special behavior.
 */
export function SafeSuspense({ children, fallback, featureName: _featureName }) {
  return (
    <ChunkErrorBoundary>
      <React.Suspense fallback={fallback || <DefaultFallback />}>{children}</React.Suspense>
    </ChunkErrorBoundary>
  );
}

function DefaultFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
    </div>
  );
}
