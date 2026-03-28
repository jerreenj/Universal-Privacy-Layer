import { useState, useEffect } from "react";
import { PricingSection } from "@/components/ui/pricing";
import { ArrowLeft, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

function PaymentStatus({ sessionId, status: urlStatus }) {
  const [paymentData, setPaymentData] = useState(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let attempts = 0;
    const maxAttempts = 8;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setPolling(false);
        return;
      }
      try {
        const token = localStorage.getItem("_upl_tok");
        const { data } = await axios.get(`${API}/api/payments/status/${sessionId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        setPaymentData(data);
        if (data.payment_status === "paid" || data.status === "expired") {
          setPolling(false);
          return;
        }
      } catch (e) {
        console.error("Poll error:", e);
      }
      attempts++;
      setTimeout(poll, 2500);
    };
    poll();
  }, [sessionId]);

  if (!sessionId) return null;

  const isPaid = paymentData?.payment_status === "paid";
  const isCancelled = urlStatus === "cancelled";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" data-testid="payment-status-modal">
      <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-8 max-w-md w-full mx-4 text-center">
        {polling ? (
          <>
            <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Verifying Payment...</h3>
            <p className="text-neutral-400 text-sm">Checking with Stripe. This may take a moment.</p>
          </>
        ) : isPaid ? (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Payment Successful</h3>
            <p className="text-neutral-400 text-sm mb-4">
              {paymentData?.metadata?.plan_name || "Plan"} activated. Welcome to the shadows.
            </p>
            <p className="text-xs text-neutral-500">
              Amount: ${((paymentData?.amount_total || 0) / 100).toFixed(2)} {paymentData?.currency?.toUpperCase()}
            </p>
          </>
        ) : isCancelled ? (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Payment Cancelled</h3>
            <p className="text-neutral-400 text-sm">No charges were made. Choose a plan when you're ready.</p>
          </>
        ) : (
          <>
            <XCircle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Payment Pending</h3>
            <p className="text-neutral-400 text-sm">Could not confirm payment. Check your email for confirmation.</p>
          </>
        )}
        <button
          data-testid="payment-status-close"
          onClick={() => window.history.replaceState({}, "", "/pricing")}
          className="mt-6 px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
          onClickCapture={() => window.location.href = "/pricing"}
        >
          Back to Pricing
        </button>
      </div>
    </div>
  );
}

export default function PricingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const urlStatus = searchParams.get("status");
  const [checkoutLoading, setCheckoutLoading] = useState(null);

  // Override plan button clicks to trigger Stripe checkout
  useEffect(() => {
    const handleClick = async (e) => {
      const link = e.target.closest("a[href='#']");
      if (!link) return;
      e.preventDefault();

      // Find which plan was clicked by matching button text
      const btnText = link.textContent.trim();
      let planId = null;

      // Check if annual toggle is active
      const annualBtn = document.querySelector("button:nth-child(3)");
      const isAnnual = annualBtn?.classList?.contains?.("text-primary-foreground");

      for (const plan of plans) {
        if (btnText === plan.buttonText) {
          if (isAnnual && plan.annualPlanId) {
            planId = plan.annualPlanId;
          } else {
            planId = plan.planId;
          }
          break;
        }
      }

      if (!planId) return;
      if (planId === "wraith" || planId === "wraith_annual") {
        window.open("mailto:contact@privacycloak.in?subject=Wraith%20Plan%20Inquiry", "_blank");
        return;
      }

      setCheckoutLoading(planId);
      try {
        const token = localStorage.getItem("_upl_tok");
        const origin = window.location.origin;
        const { data } = await axios.post(
          `${API}/api/payments/checkout`,
          { plan_id: planId, origin_url: origin },
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (data.url) {
          window.location.href = data.url;
        }
      } catch (err) {
        console.error("Checkout error:", err);
        alert("Payment initiation failed. Please try again.");
      } finally {
        setCheckoutLoading(null);
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return (
    <div className="min-h-screen bg-background" data-testid="pricing-page">
      {(sessionId || urlStatus) && (
        <PaymentStatus sessionId={sessionId} status={urlStatus} />
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
      {checkoutLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 text-white">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Redirecting to checkout...</span>
          </div>
        </div>
      )}
    </div>
  );
}
