import { PricingSection } from "@/components/ui/pricing";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

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
    href: "/",
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
    href: "/",
    isPopular: true,
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
    href: "/",
  },
];

export default function PricingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background" data-testid="pricing-page">
      <div className="absolute top-6 left-6 z-20">
        <button
          data-testid="pricing-back-btn"
          onClick={() => navigate(-1)}
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
