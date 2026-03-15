import React from 'react';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
      <p className="text-white/50 mb-8">Last updated: December 2025</p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
        <p className="text-white/70 leading-relaxed">
          By accessing or using Universal Privacy Layer ("UPL"), you agree to be bound by these Terms of Service. 
          If you do not agree, do not use the service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
        <p className="text-white/70 leading-relaxed">
          UPL provides privacy-enhanced cryptocurrency transaction tools including stealth addresses, 
          cross-chain splits, and zero-knowledge proof verification across supported EVM chains.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">3. User Responsibilities</h2>
        <ul className="text-white/70 leading-relaxed list-disc pl-6 space-y-2">
          <li>You are responsible for maintaining the security of your wallet and seed phrases</li>
          <li>You must comply with all applicable laws in your jurisdiction</li>
          <li>You must not use UPL for illegal activities including money laundering</li>
          <li>You are solely responsible for your transactions and their consequences</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">4. Risks</h2>
        <p className="text-white/70 leading-relaxed">
          Cryptocurrency transactions carry inherent risks including loss of funds, smart contract vulnerabilities, 
          and network failures. UPL is provided "as is" without warranties. You use the service at your own risk.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">5. Limitation of Liability</h2>
        <p className="text-white/70 leading-relaxed">
          UPL and its developers shall not be liable for any direct, indirect, incidental, or consequential 
          damages arising from your use of the service, including loss of funds or data.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">6. Changes to Terms</h2>
        <p className="text-white/70 leading-relaxed">
          We reserve the right to modify these terms at any time. Continued use of UPL after changes 
          constitutes acceptance of the new terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">7. Contact</h2>
        <p className="text-white/70 leading-relaxed">
          For questions about these terms, contact us at legal@privacycloak.in
        </p>
      </section>
    </div>
  );
}
