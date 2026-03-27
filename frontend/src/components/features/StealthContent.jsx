import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { StealthMeta } from "@/components/features/StealthMeta";
import { StealthSend } from "@/components/features/StealthSend";
import { StealthReceive } from "@/components/features/StealthReceive";

export function StealthContent() {
  const { address, chain, signer } = useWallet();
  const [tab, setTab] = useState("meta");
  const tabs = [
    { id: "meta",    label: "My Identity" },
    { id: "send",    label: "Send Privately" },
    { id: "receive", label: "Scan & Receive" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-white/10">
        {tabs.map(t => (
          <button
            key={t.id}
            data-testid={`stealth-tab-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${tab === t.id ? "border-white text-white" : "border-transparent text-white/40 hover:text-white/70"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "meta"    && <StealthMeta address={address} />}
      {tab === "send"    && <StealthSend address={address} chain={chain} signer={signer} />}
      {tab === "receive" && <StealthReceive address={address} signer={signer} />}
    </div>
  );
}
