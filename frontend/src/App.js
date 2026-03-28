import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import axios from "axios";
import { Toaster } from "sonner";
import "@/App.css";

// Session management — must import before any components to set up interceptor
import { getSessionToken, setOnSessionExpired } from "@/lib/session";

// Config & Context
import { API } from "@/config/chains";
import { WalletProvider } from "@/context/WalletContext";

// Pages & Components
import PricingPage from "@/pages/Pricing";
import { AccessGate } from "@/components/auth/AccessGate";
import { Dashboard } from "@/components/layout/Dashboard";

function PublicApp() {
  const [granted, setGranted] = useState(false);

  // Register callback so the global interceptor can kick user back to gate
  setOnSessionExpired(() => { setGranted(false); });

  useEffect(() => {
    if (!getSessionToken()) return; // no token — show gate immediately
    // Verify token is valid against a protected endpoint
    axios.get(`${API}/stats`)
      .then(() => setGranted(true))
      .catch(() => {
        // 401 interceptor already cleared the token — just ensure gate shows
        setGranted(false);
      });
  }, []);

  const handleGranted = () => setGranted(true);

  if (!granted) return <AccessGate onGranted={handleGranted} />;

  return (
    <WalletProvider>
      <Dashboard />
      <Toaster position="bottom-right"
        toastOptions={{ style: { background: "#000", border: "1px solid #333", color: "#fff" } }} />
    </WalletProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/*" element={<PublicApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
