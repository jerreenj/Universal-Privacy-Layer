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

function App() {
  const [granted, setGranted] = useState(false);

  setOnSessionExpired(() => { setGranted(false); });

  useEffect(() => {
    if (!getSessionToken()) return;
    axios.get(`${API}/stats`)
      .then(() => setGranted(true))
      .catch(() => setGranted(false));
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/*" element={
          !granted ? (
            <AccessGate onGranted={() => setGranted(true)} />
          ) : (
            <WalletProvider>
              <Dashboard />
              <Toaster position="bottom-right"
                toastOptions={{ style: { background: "#000", border: "1px solid #333", color: "#fff" } }} />
            </WalletProvider>
          )
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
