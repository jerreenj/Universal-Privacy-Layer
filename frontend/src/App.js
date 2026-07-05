import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Toaster } from "sonner";
import "@/App.css";

// Session management — must import before any components to set up interceptor
import { getSessionToken, setOnSessionExpired } from "@/lib/session";

// Config & Context
import { API } from "@/config/chains";
import { WalletProvider } from "@/context/WalletContext";
import { ChunkErrorBoundary } from "@/components/common/ChunkErrorBoundary";

// Pages & Components — lazy-loaded so each route ships in its own chunk and
// the wallet SDKs / route components don't block first paint of the landing
// page. AccessGate/Dashboard are only fetched when the user navigates to
// them, keeping TBT low on the initial load.
const AccessGate = lazy(() => import("@/components/auth/AccessGate").then(m => ({ default: m.AccessGate })));
const Dashboard = lazy(() => import("@/components/layout/Dashboard").then(m => ({ default: m.Dashboard })));

// Visible fallback while the lazy Dashboard chunk is loading. Previously
// this returned `null`, which was a root cause of "blank screen on first
// paint" reports — any slow chunk load rendered literally nothing.
const RouteFallback = () => (
  <div className="min-h-screen bg-black flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      <div className="text-xs text-white/40 uppercase tracking-wider">Loading…</div>
    </div>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        {/* Root boundary — catches anything that escapes Dashboard's
            per-feature SafeSuspense and renders a visible error panel
            instead of letting React unmount the whole tree (which was
            producing blank-screen reports). */}
        <ChunkErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/*" element={
                <>
                  <Dashboard />
                  <Toaster position="bottom-right"
                    toastOptions={{ style: { background: "#000", border: "1px solid #333", color: "#fff" } }} />
                </>
              } />
            </Routes>
          </Suspense>
        </ChunkErrorBoundary>
      </WalletProvider>
    </BrowserRouter>
  );
}

export default App;
