import { ArrowLeft } from "lucide-react";

export function BackButton({ onClick }) {
  return (
    <button onClick={onClick} data-testid="back-button"
      className="flex items-center gap-2 px-4 py-2 border border-white/30 hover:border-white hover:bg-white hover:text-black transition-all duration-200 text-sm font-medium mb-6 group">
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
      Back
    </button>
  );
}
