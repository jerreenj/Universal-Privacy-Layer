import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function copyToClip(text) {
  const el = Object.assign(document.createElement("textarea"), { value: text });
  Object.assign(el.style, { position: "fixed", top: 0, left: 0, opacity: "0" });
  document.body.appendChild(el); el.focus(); el.select();
  document.execCommand("copy"); document.body.removeChild(el);
}

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { copyToClip(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-500 hover:text-white" />}
    </button>
  );
}
