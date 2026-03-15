import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
      <p className="text-white/50 mb-8">Last updated: December 2025</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">1. Overview</h2>
        <p className="text-white/70 leading-relaxed">
          Universal Privacy Layer ("UPL") is designed with privacy as a core principle. 
          This policy explains what data we collect and how we handle it.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">2. Data We Collect</h2>
        <ul className="text-white/70 leading-relaxed list-disc pl-6 space-y-2">
          <li><strong>Wallet Addresses:</strong> Public blockchain addresses you connect</li>
          <li><strong>Transaction Data:</strong> On-chain transaction hashes for history display</li>
          <li><strong>Stealth Addresses:</strong> Generated addresses (stored locally and optionally on our servers)</li>
          <li><strong>API Usage:</strong> Request counts for rate limiting</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">3. Data We Do NOT Collect</h2>
        <ul className="text-white/70 leading-relaxed list-disc pl-6 space-y-2">
          <li>Private keys or seed phrases</li>
          <li>Personal identification information</li>
          <li>IP addresses (not logged)</li>
          <li>Browsing history outside UPL</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">4. How We Use Data</h2>
        <p className="text-white/70 leading-relaxed">
          Data is used solely to provide UPL services: generating stealth addresses, 
          displaying transaction history, and managing API access. We do not sell or share data with third parties.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">5. Data Storage</h2>
        <p className="text-white/70 leading-relaxed">
          Privacy wallet keys are stored locally on your device. Optional server-side data 
          (stealth address registry, transaction history) is stored in encrypted databases.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">6. Blockchain Privacy</h2>
        <p className="text-white/70 leading-relaxed">
          UPL uses stealth addresses and ZKP proofs to enhance on-chain privacy. However, 
          blockchain transactions are inherently public. UPL reduces traceability but cannot 
          guarantee complete anonymity.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">7. Your Rights</h2>
        <ul className="text-white/70 leading-relaxed list-disc pl-6 space-y-2">
          <li>Request deletion of your data from our servers</li>
          <li>Export your transaction history</li>
          <li>Disconnect wallet at any time</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">8. Contact</h2>
        <p className="text-white/70 leading-relaxed">
          For privacy concerns, contact privacy@privacycloak.in
        </p>
      </section>
    </div>
  );
}
