import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Wallet, Eye, Send, Split, Shield, Key } from 'lucide-react';

const steps = [
  {
    id: 1,
    title: "Connect Your Wallet",
    icon: <Wallet className="w-6 h-6" />,
    content: `Click "Connect Wallet" and select MetaMask (or your preferred EVM wallet). 
    UPL supports 7 chains: Base, Arbitrum, Polygon, Optimism, BNB Chain, Avalanche, and Hyperliquid.`
  },
  {
    id: 2,
    title: "Set Up Privacy Wallet",
    icon: <Key className="w-6 h-6" />,
    content: `Go to "Dual Seed Setup" in the dashboard. Enter your main seed phrase and a separate privacy seed phrase. 
    This dual-key system enables stealth address generation for enhanced privacy.`
  },
  {
    id: 3,
    title: "Generate Stealth Address",
    icon: <Eye className="w-6 h-6" />,
    content: `Navigate to "Private Receive" and click "Generate Stealth Address". 
    Share this one-time address with senders. Each address is unique and unlinkable to your main wallet.`
  },
  {
    id: 4,
    title: "Send Privately",
    icon: <Send className="w-6 h-6" />,
    content: `Use "Private Send" to transfer funds through the privacy relayer. 
    Enter the recipient's stealth address and amount. The transaction will be routed privately.`
  },
  {
    id: 5,
    title: "Cross-Chain Split",
    icon: <Split className="w-6 h-6" />,
    content: `For maximum privacy, use "Cross-Chain Split" to divide a payment across multiple chains. 
    Configure percentages for each chain and execute. Funds become virtually untraceable.`
  },
  {
    id: 6,
    title: "View Hidden Balance",
    icon: <Shield className="w-6 h-6" />,
    content: `Check "Hidden Balance" to see funds across all your stealth addresses on every chain. 
    Only you can see this aggregated view using your viewing key.`
  }
];

export default function OnboardingGuide() {
  const [expandedStep, setExpandedStep] = useState(1);

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">Getting Started with UPL</h1>
      <p className="text-white/50 mb-8">Follow these steps to start using private transactions</p>

      <div className="space-y-4">
        {steps.map((step) => (
          <div 
            key={step.id}
            className={`border transition-all ${expandedStep === step.id ? 'border-white/30 bg-white/5' : 'border-white/10'}`}
          >
            <button
              onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
              className="w-full flex items-center gap-4 p-4 text-left"
            >
              <div className={`w-10 h-10 flex items-center justify-center ${expandedStep === step.id ? 'bg-white text-black' : 'bg-white/10'}`}>
                {step.id}
              </div>
              <div className="flex-1 flex items-center gap-3">
                {step.icon}
                <span className="font-semibold">{step.title}</span>
              </div>
              {expandedStep === step.id ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
            </button>
            
            {expandedStep === step.id && (
              <div className="px-4 pb-4 pl-18">
                <p className="text-white/70 leading-relaxed ml-14">{step.content}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-12 p-6 border border-green-500/30 bg-green-500/5">
        <h2 className="text-lg font-semibold text-green-400 mb-3">Pro Tips</h2>
        <ul className="text-white/70 space-y-2 text-sm">
          <li>• Use a different stealth address for each transaction</li>
          <li>• Enable cross-chain splits for large transactions</li>
          <li>• Check ZKP Proofs to verify transaction privacy</li>
          <li>• Never share your seed phrases with anyone</li>
        </ul>
      </div>
    </div>
  );
}
