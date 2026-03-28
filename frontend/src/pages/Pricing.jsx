import { useState, useEffect, useCallback } from "react";
import { PricingSection } from "@/components/ui/pricing";
import { ArrowLeft, Copy, CheckCircle, X, Wallet, Loader2, QrCode, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
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
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("wallet"); // "wallet" | "qr" | "manual"
  const [walletSending, setWalletSending] = useState(false);
  const [walletSuccess, setWalletSuccess] = useState(false);
  const [buyerEmail, setBuyerEmail] = useState("");
  const [emailSubmitted, setEmailSubmitted] = useState(false);

  useEffect(() => {
    axios.get(`${API}/api/payments/info`).then(r => setPaymentInfo(r.data)).catch(() => {});
  }, []);

  const wallet = paymentInfo?.wallet || "";
  const amountUsd = paymentInfo?.plans?.[planId]?.amount_usd || 0;

  const copyWallet = useCallback(() => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [wallet]);

  // EIP-681 URI for QR code (ethereum:address?value=0)
  const ethUri = `ethereum:${wallet}`;

  // Send via MetaMask / injected wallet
  const sendViaWallet = async () => {
    if (!window.ethereum) {
      setError("No wallet detected. Install MetaMask or use the QR/Manual tab.");
      return;
    }
    setWalletSending(true);
    setError("");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const from = accounts[0];
      setSenderAddr(from);

      const txParams = {
        from,
        to: wallet,
        value: "0x0", // User sends the amount they want in their chosen token
      };

      const hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [txParams],
      });

      setTxHash(hash);

      // Detect chain
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      const chainMap = {
        "0x1": "ethereum", "0x89": "polygon", "0xa": "optimism",
        "0x2105": "base", "0xa4b1": "arbitrum", "0x38": "bnb", "0xa86a": "avalanche",
      };
      setSelectedChain(chainMap[chainId] || "ethereum");

      // Auto-submit
      await axios.post(`${API}/api/payments/submit`, {
        plan_id: planId,
        tx_hash: hash,
        chain: chainMap[chainId] || "ethereum",
        token: selectedToken,
        sender_address: from,
      });
      setWalletSuccess(true);
      setSubmitted(true);
    } catch (e) {
      if (e.code === 4001) {
        setError("Transaction rejected by user.");
      } else {
        setError(e.message || "Wallet transaction failed.");
      }
    } finally {
      setWalletSending(false);
    }
  };

  const handleManualSubmit = async () => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" data-testid="crypto-payment-modal">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-green-400" />
              <h3 className="text-lg font-bold text-white">Pay with Crypto</h3>
            </div>
            <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors" data-testid="close-payment-modal">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Plan + Amount */}
          <div className="bg-neutral-800/50 rounded-xl p-4 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-neutral-400 text-sm">{plan?.name || paymentInfo.plans?.[planId]?.name}</span>
              <span className="text-2xl font-bold text-white">${amountUsd.toLocaleString()}</span>
            </div>
            <p className="text-neutral-600 text-xs mt-1">Send equivalent in any accepted token</p>
          </div>

          {submitted ? (
            <div className="text-center py-6">
              <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
              <h4 className="text-xl font-bold text-white mb-2">Payment Submitted</h4>
              <p className="text-neutral-400 text-sm">We'll verify your transaction and activate your plan shortly.</p>
              {txHash && <p className="text-neutral-600 text-xs mt-3 font-mono break-all">TX: {txHash}</p>}

              {/* Email collection */}
              {!emailSubmitted ? (
                <div className="mt-5 space-y-3">
                  <p className="text-neutral-400 text-xs">Leave your email so we can reach out with your access code:</p>
                  <input
                    type="email"
                    value={buyerEmail}
                    onChange={e => setBuyerEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-green-500"
                    data-testid="buyer-email-input"
                  />
                  <button
                    onClick={async () => {
                      if (!buyerEmail.trim() || !buyerEmail.includes("@")) return;
                      try {
                        await axios.post(`${API}/api/payments/email`, { tx_hash: txHash, email: buyerEmail.trim() });
                        setEmailSubmitted(true);
                      } catch {}
                    }}
                    disabled={!buyerEmail.includes("@")}
                    className="w-full py-2.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 disabled:opacity-40 transition-colors text-sm font-medium"
                    data-testid="submit-email-btn"
                  >
                    Submit Email
                  </button>
                </div>
              ) : (
                <p className="text-green-400 text-xs mt-4">Email saved. We'll be in touch.</p>
              )}

              <div className="mt-4 p-3 bg-neutral-800/50 rounded-lg">
                <p className="text-neutral-500 text-xs">
                  Already paid? Contact <a href="mailto:jerreen@jasprlabs.com" className="text-green-400 hover:underline">jerreen@jasprlabs.com</a> to get your access code.
                </p>
              </div>

              <button onClick={onClose} className="mt-4 px-6 py-2.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors text-sm font-medium" data-testid="payment-done-btn">
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Tab switcher */}
              <div className="flex gap-1 bg-neutral-800 rounded-lg p-1 mb-5">
                {[
                  { id: "wallet", label: "Wallet", icon: <Zap className="w-3.5 h-3.5" /> },
                  { id: "qr", label: "QR Code", icon: <QrCode className="w-3.5 h-3.5" /> },
                  { id: "manual", label: "Manual", icon: <Copy className="w-3.5 h-3.5" /> },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
                      tab === t.id ? "bg-green-500/20 text-green-400" : "text-neutral-500 hover:text-neutral-300"
                    }`}
                    data-testid={`tab-${t.id}`}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {/* ─── WALLET TAB ─── */}
              {tab === "wallet" && (
                <div className="space-y-4">
                  <p className="text-neutral-400 text-sm text-center">
                    Connect your wallet and send payment in one click.
                  </p>

                  {/* Token selector */}
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Pay with</label>
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

                  <button
                    onClick={sendViaWallet}
                    disabled={walletSending}
                    className="w-full py-3.5 bg-green-500 hover:bg-green-600 disabled:bg-neutral-700 text-black font-bold rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                    data-testid="pay-with-wallet-btn"
                  >
                    {walletSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {walletSending ? "Confirm in Wallet..." : "Pay with Connected Wallet"}
                  </button>

                  {!window.ethereum && (
                    <p className="text-yellow-500/70 text-xs text-center">No wallet detected. Use QR Code or Manual tab instead.</p>
                  )}
                </div>
              )}

              {/* ─── QR CODE TAB ─── */}
              {tab === "qr" && (
                <div className="space-y-4">
                  <p className="text-neutral-400 text-sm text-center">
                    Scan with any crypto wallet app to send payment.
                  </p>

                  {/* QR Code */}
                  <div className="flex justify-center">
                    <div className="bg-white p-4 rounded-xl">
                      <QRCodeSVG
                        value={ethUri}
                        size={200}
                        level="H"
                        bgColor="#ffffff"
                        fgColor="#000000"
                        data-testid="payment-qr-code"
                      />
                    </div>
                  </div>

                  {/* Wallet address below QR */}
                  <div className="flex items-center gap-2 bg-neutral-800 rounded-lg p-3 border border-neutral-700">
                    <code className="text-green-400 text-xs flex-1 break-all font-mono" data-testid="payout-wallet">{wallet}</code>
                    <button onClick={copyWallet} className="text-neutral-400 hover:text-white transition-colors shrink-0" data-testid="copy-wallet-btn">
                      {copied ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="bg-neutral-800/50 rounded-lg p-3">
                    <p className="text-neutral-500 text-xs text-center">
                      Send <span className="text-white font-semibold">${amountUsd.toLocaleString()}</span> equivalent in ETH, USDC, USDT, or any accepted token to the address above.
                    </p>
                  </div>

                  {/* After scanning, user enters tx hash */}
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Paste your tx hash after sending</label>
                    <input
                      type="text"
                      value={txHash}
                      onChange={e => setTxHash(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-green-500 font-mono"
                      data-testid="tx-hash-input-qr"
                    />
                  </div>

                  <select
                    value={selectedChain}
                    onChange={e => setSelectedChain(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-green-500"
                    data-testid="chain-select-qr"
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

                  <button
                    onClick={handleManualSubmit}
                    disabled={submitting || !txHash}
                    className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-neutral-700 disabled:text-neutral-500 text-black font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                    data-testid="submit-qr-payment-btn"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {submitting ? "Submitting..." : "Confirm Payment"}
                  </button>
                </div>
              )}

              {/* ─── MANUAL TAB ─── */}
              {tab === "manual" && (
                <div className="space-y-4">
                  <p className="text-neutral-400 text-sm text-center">
                    Send crypto manually and paste the transaction details.
                  </p>

                  {/* Wallet Address */}
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Send to</label>
                    <div className="flex items-center gap-2 bg-neutral-800 rounded-lg p-3 border border-neutral-700">
                      <code className="text-green-400 text-xs flex-1 break-all font-mono">{wallet}</code>
                      <button onClick={copyWallet} className="text-neutral-400 hover:text-white transition-colors shrink-0">
                        {copied ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Token */}
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Token</label>
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

                  {/* Chain */}
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Chain</label>
                    <select
                      value={selectedChain}
                      onChange={e => setSelectedChain(e.target.value)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-green-500"
                      data-testid="chain-select-manual"
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
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Transaction hash</label>
                    <input
                      type="text"
                      value={txHash}
                      onChange={e => setTxHash(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-green-500 font-mono"
                      data-testid="tx-hash-input-manual"
                    />
                  </div>

                  {/* Sender */}
                  <div>
                    <label className="text-xs text-neutral-500 uppercase tracking-wider mb-2 block">Your wallet <span className="text-neutral-600">(optional)</span></label>
                    <input
                      type="text"
                      value={senderAddr}
                      onChange={e => setSenderAddr(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-lg p-3 text-white text-sm placeholder-neutral-600 focus:outline-none focus:border-green-500 font-mono"
                      data-testid="sender-input-manual"
                    />
                  </div>

                  <button
                    onClick={handleManualSubmit}
                    disabled={submitting}
                    className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-neutral-700 text-black font-bold rounded-lg transition-colors flex items-center justify-center gap-2"
                    data-testid="submit-manual-payment-btn"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {submitting ? "Submitting..." : "Submit Payment"}
                  </button>
                </div>
              )}

              {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}

              <p className="text-neutral-600 text-xs text-center mt-4">
                All payments verified on-chain. Plan activated within minutes.
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
        window.open("mailto:jerreen@jasprlabs.com?subject=Wraith%20Plan%20Inquiry", "_blank");
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
      <div className="text-center pb-12 px-4">
        <p className="text-neutral-500 text-sm">
          Already purchased? Contact <a href="mailto:jerreen@jasprlabs.com" className="text-green-400 hover:underline font-medium">jerreen@jasprlabs.com</a> to get your access code.
        </p>
      </div>
    </div>
  );
}
