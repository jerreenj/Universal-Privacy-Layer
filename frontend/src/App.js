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

// Pages & Components — lazy-loaded so each route ships in its own chunk and
// the wallet SDKs / route components don't block first paint of the landing
// page. AccessGate/Pricing/Dashboard are only fetched when the user navigates
// to them, keeping TBT low on the initial load.
const PricingPage = lazy(() => import("@/pages/Pricing"));
const AccessGate = lazy(() => import("@/components/auth/AccessGate").then(m => ({ default: m.AccessGate })));
const Dashboard = lazy(() => import("@/components/layout/Dashboard").then(m => ({ default: m.Dashboard })));

// Minimal inline fallback — avoids an extra network round-trip for a Suspense
// boundary component and shows nothing rather than flashing a blank shell.
const RouteFallback = () => null;

function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/pricing" element={<PricingPage />} />
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
