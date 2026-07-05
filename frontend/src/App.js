import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Toaster } from "sonner";
import "@/App.css";

import { getSessionToken, setOnSessionExpired } from "@/lib/session";
import { API } from "@/config/chains";
import { WalletProvider } from "@/context/WalletContext";
import { FeatureErrorBoundary } from "@/components/common/FeatureErrorBoundary";

const AccessGate = lazy(() => import("@/components/auth/AccessGate").then(m => ({ default: m.AccessGate })));
const Dashboard = lazy(() => import("@/components/layout/Dashboard").then(m => ({ default: m.Dashboard })));

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
      </WalletProvider>
    </BrowserRouter>
  );
}

export default App;
