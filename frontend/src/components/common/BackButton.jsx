import { ArrowLeft } from "lucide-react";

/**
 * BackButton — visible, top-of-subpage, large. Cleared up because users were
 * reporting that sub-pages had "no back action". Always falls back to the
 * Dashboard home if no history is available.
 */
export function BackButton({ onClick }) {
  return (
    <button
      onClick={onClick || (() => {
        // Smart default: walk browser history if there's a previous
        // in-stack entry, otherwise jump to the Dashboard root so the
        // user is never stranded on a sub-page with no escape hatch.
        try {
          if (window.history.length > 1) window.history.back();
          else window.history.replaceState(null, "", "/");
        } catch {
          window.location.href = "/";
        }
      })}
      data-testid="back-button"
      data-feature-back
      className="flex items-center gap-2 px-5 py-2.5 border-2 border-white/40 hover:border-white hover:bg-white hover:text-black transition-all duration-200 text-sm font-semibold mb-6 group bg-black/40"
    >
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
      Back to Dashboard
    </button>
  );
}
