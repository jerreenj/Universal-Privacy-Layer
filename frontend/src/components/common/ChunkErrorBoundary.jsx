import React from "react";

/**
 * ChunkErrorBoundary — silently self-heals chunk-load failures.
 *
 * If a lazy-loaded chunk fails to load (network blip, stale hash after a
 * redeploy, etc.), the previous version rendered a yellow "Refresh to
 * latest build" panel. That was wrong — users just see an error screen.
 *
 * New behavior: on a chunk-load failure, we DO NOT render an error
 * panel. Instead we immediately force a hard reload of the page so the
 * browser fetches the latest bundle. The user sees one brief flash,
 * then the working page.
 *
 * As an extra safety net, we ALSO listen on window for the unhandled
 * `ChunkLoadError` event so even lazy imports that escape this
 * boundary get caught and reloaded.
 *
 * LocalStorage guards against infinite reload loops: if we have
 * reloaded within the last 10 seconds for the same reason, we render a
 * tiny "Reload again" link instead of reloading a third time.
 */
const RELOAD_KEY = "upl-chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkError(error) {
  if (!error) return false;
  const name = error.name || "";
  const msg = (error.message || "") + "";
  return (
    name === "ChunkLoadError" ||
    /Loading chunk [\d]+ failed/.test(msg) ||
    /Loading CSS chunk [\d]+ failed/.test(msg) ||
    /Failed to fetch dynamically imported module/.test(msg) ||
    /Importing a module script failed/.test(msg)
  );
}

function recentlyReloaded() {
  try {
    const at = Number(localStorage.getItem(RELOAD_KEY) || 0);
    return Date.now() - at < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function forceHardReload() {
  try {
    localStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {}
  try {
    // Bust any HTTP cache + service-worker cache so the reload truly
    // re-fetches every asset from the network.
    const url = new URL(window.location.href);
    url.searchParams.set("__r", String(Date.now()));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
}

// Catch chunk-load errors that happen OUTSIDE React's render path
// (e.g. a dynamically imported module that fails after first paint).
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    if (event && isChunkError(event.error)) {
      event.preventDefault();
      if (!recentlyReloaded()) forceHardReload();
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (event && isChunkError(event.reason)) {
      event.preventDefault();
      if (!recentlyReloaded()) forceHardReload();
    }
  });
}

export class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    if (isChunkError(error)) {
      // Self-heal: hard-reload now so the user gets the latest bundle.
      if (!recentlyReloaded()) {
        forceHardReload();
        return;
      }
    }
    // eslint-disable-next-line no-console
    console.error("[ChunkErrorBoundary] caught:", error);
  }

  render() {
    // NO error → render children normally.
    if (!this.state.error) return this.props.children;

    // ── Error is set. NEVER return children here — children would
    //    re-throw the same error, React would unmount the whole tree,
    //    and the user would see a blank screen. Always render a
    //    visible fallback (this is the fix for the blank-screen bug). ──

    const err = this.state.error;
    const chunkErr = isChunkError(err);

    // Chunk error + haven't reloaded recently → trigger reload.
    // (componentDidCatch already called forceHardReload; this branch is
    // just the render-side guard for the brief moment before navigation.)
    if (chunkErr && !recentlyReloaded()) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      );
    }

    // Chunk error + already reloaded (loop guard) OR any other error →
    // show a visible error panel with Back + Reload buttons. The user
    // is NEVER left on a blank screen.
    const msg = (err && (err.message || err.toString())) || "Unknown error";
    return (
      <div className="space-y-4" data-testid="feature-error">
        <div className="bg-red-500/10 border border-red-500/30 p-4 text-sm text-red-300 space-y-2">
          <div className="font-semibold">
            {chunkErr ? "This page didn't finish loading." : "This feature hit an error."}
          </div>
          <div className="text-xs text-red-200/70 font-mono break-all">{String(msg).slice(0, 300)}</div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => forceHardReload()}
            className="flex-1 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black text-sm font-medium"
          >
            Reload page
          </button>
          <button
            onClick={() => {
              try {
                window.history.pushState(null, "", "/");
                window.dispatchEvent(new PopStateEvent("popstate"));
              } catch {
                window.location.href = "/";
              }
            }}
            className="flex-1 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black text-sm font-medium"
          >
            Back to Dashboard
          </button>
        </div>
        <p className="text-[11px] text-white/30 leading-relaxed">
          If this keeps happening, try a hard refresh (Ctrl+Shift+R / Cmd+Shift+R) to clear your browser cache.
        </p>
      </div>
    );
  }
}

/**
 * SafeSuspense — wraps a lazy component in both Suspense (loading
 * spinner) and a ChunkErrorBoundary (auto-reload on chunk error).
 */
export function SafeSuspense({ children, fallback, featureName: _featureName }) {
  return (
    <ChunkErrorBoundary>
      <React.Suspense fallback={fallback}>{children}</React.Suspense>
    </ChunkErrorBoundary>
  );
}
