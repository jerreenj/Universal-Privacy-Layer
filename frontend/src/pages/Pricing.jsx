import { useState, useEffect, useCallback } from "react";
import { PricingSection } from "@/components/ui/pricing";
import { ArrowLeft, Copy, CheckCircle, X, Wallet, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API = process.env.REACT_APP_BACKEND_URL;

const plans = [
  {
    name: "Phantom",
    price: "50",
    yearlyPrice: "50",
    period: "14-day trial",
    features: [
      "$499/mo after 14 days",
      "Stealth address generation",
      "Off-chain stealth payments",
      "Encrypted P2P messaging",
      "5 privacy transactions / day",
      "Community support",
    ],
    description: "For the solo operator. Move in silence.",
    buttonText: "Start 14-Day Trial — $50",
    href: "#",
    planId: "phantom_trial",
  },
  {
    name: "Specter",
    price: "4999",
    yearlyPrice: "3999",
    period: "month",
    features: [
      "Unlimited stealth transactions",
      "Cross-chain split payments",
      "Private DeFi routing (Uniswap, Polymarket)",
      "ZK proof generation",
      "On-chain relayer access",
      "Priority support",
    ],
    description: "For individuals who demand full privacy.",
    buttonText: "Go Dark",
    href: "#",
    isPopular: true,
    planId: "specter",
    annualPlanId: "specter_annual",
  },
  {
    name: "Wraith",
    price: "24999",
    yearlyPrice: "19999",
    period: "month",
    features: [
      "Everything in Specter",
      "Dedicated privacy relayer node",
      "Multi-sig privacy vaults",
      "Custom stealth address registry",
      "SDK & API access (unlimited)",
      "Dedicated account manager",
    ],
    description: "Enterprise-grade invisibility for institutions.",
    buttonText: "Contact Us",
    href: "#",
    planId: "wraith",
    annualPlanId: "wraith_annual",
  },
];

function CryptoPaymentModal({ plan, planId, onClose }) {
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [senderAddr, setSenderAddr] = useState("");
  const [selectedChain, setSelectedChain] = useState("");
  const [selectedToken, setSelectedToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${API}/api/payments/info`).then(r => setPaymentInfo(r.data)).catch(() => {});
  }, []);

  const copyWallet = useCallback(() => {
    if (!paymentInfo?.wallet) return;
    navigator.clipboard.writeText(paymentInfo.wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [paymentInfo]);

  const handleSubmit = async () => {
    if (!txHash.trim()) { setError("Enter your transaction hash"); return; }
    if (!selectedChain) { setError("Select the chain you sent on"); return; }
    setError("");
    setSubmitting(true);
    try {
      await axios.post(`${API}/api/payments/submit`, {
        plan_id: planId,
        tx_hash: txHash.trim(),
        chain: selectedChain,
        token: selectedToken || "ETH",
        sender_address: senderAddr.trim(),
      });
      setSubmitted(true);
    } catch (e) {
      setError(e.response?.data?.detail || "Submission failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!paymentInfo) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <Loader2 className="w-8 h-8 text-green-400 animate-spin" />
      </div>
    );
  }

  const amountUsd = paymentInfo.plans?.[planId]?.amount_usd || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" data-testid="crypto-payment-modal">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-green-400" />
              <h3 className="text-lg font-bold text-white">Pay with Crypto</h3>
            </div>
            <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors" data-testid="close-payment-modal">
              <X className="w-5 h-5" />
            </button>
          </div>

          {submitted ? (
            <div className="text-center py-8">
              <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
              <h4 className="text-xl font-bold text-white mb-2">Payment Submitted</h4>
              <p className="text-neutral-400 text-sm">We'll verify your transaction and activate your plan shortly.</p>
              <button onClick={onClose} className="mt-6 px-6 py-2.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm font-medium" data-testid="payment-done-btn">
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Plan + Amount */}
              <div className="bg-neutral-800/50 rounded-xl p-4 mb-5">
                <div className="flex justify-between items-center">
                  <span className="text-neutral-400 text-sm">{plan?.name || paymentInfo.plans?.[planId]?.name}</span>
                  <span className="text-2xl font-bold text-white">${amountUsd.toLocaleString()}</span>
                </div>
              </div>

              {/* Wallet Address */}
              <div className="mb-5">
                <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Send to this wallet</label>
                <div className="flex items-center gap-2 bg-neutral-800 rounded-lg p-3 border border-neutral-700">
                  <code className="text-green-400 text-xs flex-1 break-all font-mono" data-testid="payout-wallet">{paymentInfo.wallet}</code>
                  <button onClick={copyWallet} className="text-neutral-400 hover:text-white transition-colors shrink-0" data-testid="copy-wallet-btn">
                    {copied ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Accepted Tokens */}
              <div className="mb-5">
                <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Accepted tokens</label>
                <div className="flex flex-wrap gap-2">
                  {paymentInfo.accepted_tokens?.map(t => (
                    <button
                      key={t.symbol}
                      onClick={() => setSelectedToken(t.symbol)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        selectedToken === t.symbol
                          ? "bg-green-500/20 text-green-400 border border-green-500/40"
                          : "bg-neutral-800 text-neutral-400 border border-neutral-700 hover:border-neutral-500"
                      }`}
                    >
                      {t.symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chain selector */}
              <div className="mb-5">
                <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Chain you sent on</label>
                <select
                  value={selectedChain}
                  onChange={e => setSelectedChain(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-green-500"
                  data-testid="chain-select"
                >
                  <option value="">Select chain...</option>
                  <option value="ethereum">Ethereum</option>
                  <option value="base">Base</option>
                  <option value="arbitrum">Arbitrum</option>
                  <option value="polygon">Polygon</option>
                  <option value="optimism">Optimism</option>
                  <option value="bnb">BNB Chain</option>
                  <option value="avalanche">Avalanche</option>
                </select>
              </div>

              {/* Tx Hash */}
              <div className="mb-5">
                <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Transaction hash</label>
                <input
                  type="text"
                  value={txHash}
                  onChange={e => setTxHash(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-green-500 font-mono"
                  data-testid="tx-hash-input"
                />
              </div>

              {/* Sender Address (optional) */}
              <div className="mb-5">
                <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Your wallet address <span className="text-neutral-600">(optional)</span></label>
                <input
                  type="text"
                  value={senderAddr}
                  onChange={e => setSenderAddr(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-green-500 font-mono"
                  data-testid="sender-address-input"
                />
              </div>

              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-neutral-700 text-black font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                data-testid="submit-payment-btn"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {submitting ? "Submitting..." : "Submit Payment"}
              </button>

              <p className="text-neutral-600 text-xs text-center mt-3">
                Send the exact amount in any accepted token. We'll verify on-chain and activate your plan.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PricingPage() {
  const navigate = useNavigate();
  const [paymentModal, setPaymentModal] = useState(null);

  useEffect(() => {
    const handleClick = (e) => {
      const link = e.target.closest("a[href='#']");
      if (!link) return;
      e.preventDefault();

      const btnText = link.textContent.trim();
      let planId = null;
      let matchedPlan = null;

      for (const plan of plans) {
        if (btnText === plan.buttonText) {
          planId = plan.planId;
          matchedPlan = plan;
          break;
        }
      }

      if (!planId) return;

      if (planId === "wraith" || planId === "wraith_annual") {
        window.open("mailto:contact@privacycloak.in?subject=Wraith%20Plan%20Inquiry", "_blank");
        return;
      }

      setPaymentModal({ plan: matchedPlan, planId });
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <div className="min-h-screen bg-background" data-testid="pricing-page">
      {paymentModal && (
        <CryptoPaymentModal
          plan={paymentModal.plan}
          planId={paymentModal.planId}
          onClose={() => setPaymentModal(null)}
        />
      )}
      <div className="absolute top-6 left-6 z-20">
        <button
          data-testid="pricing-back-btn"
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>
      <PricingSection
        plans={plans}
        title="Privacy Has a Price. Exposure Costs More."
        description={"Zero-knowledge transactions. Stealth addresses. On-chain anonymity.\nChoose your level of invisibility."}
      />
    </div>
  );
}
