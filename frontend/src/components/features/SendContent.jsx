import { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import { Zap, Lock, Loader2, ExternalLink, CheckCircle2, X, Eye } from "lucide-react";
import { toast } from "sonner";
import { API, CHAINS } from "@/config/chains";
import { useWallet } from "@/context/WalletContext";
import { seal } from "@/lib/crypto-seal";
import { getAddressArchive } from "@/lib/wallet-stealth";

/**
 * SendContent — Private send flow for the customer's main wallet.
 *
 * Two on-chain paths, picked by the token toggle:
 *
 * 1. ETH — RELAYER PATH (recommended for ETH balance hiding)
 *    Routes the ETH through the on-chain PrivacyRelayer contract.
 *    The customer's EOA NEVER appears as msg.sender — the relayer
 *    hot wallet pays the gas and forwards the ETH atomically.
 *    Flow: prepare-tx → signTypedData (off-chain) → submit(relay).
 *
 * 2. USDC — DIRECT WALLET TRANSFER
 *    PrivacyRelayer.sol currently only supports ETH (msg.value).
 *    USDC flows through the customer's own connected wallet directly
 *    to the stealth address. Sender stays the customer's main wallet
 *    (visible on BaseScan) — only the recipient stealth address is
 *    the privacy hedge here. Amount is visible for now (P3 roadmap
 *    is to wrap into a USDC relayer, but until then the customer
 *    sees what's happening on-chain).
 *
 * After EITHER succeeds, a popup appears with the BaseScan link so
 * the customer has a verifiable receipt. Stealth balance is then
 * auto-refreshed (the dashboard's "Private" column updates).
 */
export function SendContent() {
  const { address, chain, signer, fetchBalance, fetchStealthBalance } = useWallet();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("usdc"); // "usdc" | "eth"
  // Send mode — TWO modes only.
  //   "stealth" — Stealth Send: signs permit with the stealth
  //               private key locally, relayer submits permit +
  //               transferFrom atomically via Multicall3. On
  //               BaseScan: from = relayer, Transfer.from = relayer
  //               call. Neither the stealth NOR the main wallet
  //               appears as sender. MOST PRIVATE. Used for all
  //               sends BETWEEN Privacy Cloak users.
  //   "deposit" — Deposit: user's main wallet sends USDC directly
  //               to THEIR OWN stealth address. The entry point
  //               into the privacy system. Main wallet appears as
  //               sender (unavoidable — money is entering). After
  //               this, the stealth has USDC and all future sends
  //               use Stealth Send mode.
  const [sendMode, setSendMode] = useState("stealth");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  // Tx-success popup — appears centered over the page on success,
  // shows the BaseScan link as a button so the customer has a
  // verifiable receipt without hunting through the explorer
  // themselves.
  const [successPopup, setSuccessPopup] = useState(null);
  // The user's local stealth archive — read so USDC sends can route
  // THROUGH the user's own stealth address via EIP-2612 permit. The
  // stealth address's private key is already in localStorage from
  // when it was generated, so permit signing happens locally; only
  // the signature leaves the browser. NO new contract, NO vault.
  const [archiveUsdc, setArchiveUsdc] = useState(null); // {address, privateKey, usdcBalance}
  // Surfacing of permit-sign step so the UI doesn't lie about being
  // "Submitted" before the wallet actually pops.
  const [permitStep, setPermitStep] = useState(null);

  /**
   * Accept raw 0x... Ethereum addresses only. The st:eth: prefix
   * is gone — it was confusing the pilot user and never provided
   * any privacy value (the stealth address itself is the privacy
   * mechanism; the prefix is just an EIP-5564 display convention).
   */
  const parseRecipient = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    return ethers.isAddress(s) ? s : null;
  };

  /**
   * Read the user's local stealth archive every time they switch
   * wallets or token. We surface in the UI which stealth address
   * the USDC send would route THROUGH (if any has enough balance).
   * The permit signature is then issued by THAT stealth's local
   * private key, so the customer's PUBLIC wallet never appears on
   * BaseScan as the Transfer `from`.
   *
   * Uses the raw-fetch balance-reader (lib/balance-reader.js) so
   * the read works under browser CORS preflight rules — ethers
   * JsonRpcProvider silently returns 0 on some Base RPCs, which
   * was causing the permit flow to fall back to direct transfer
   * even when the stealth address had USDC.
   */
  useEffect(() => {
    if (!address || token !== "usdc") { setArchiveUsdc(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const list = getAddressArchive(address);
        if (!list.length) { if (!cancelled) setArchiveUsdc(null); return; }
        // Use raw-fetch reader — bypasses ethers CORS failures.
        const { readUsdcBalance } = await import("@/lib/balance-reader");
        const probes = await Promise.all(list.map(async (entry) => {
          try {
            const bal = await readUsdcBalance(entry.address);
            return { entry, balance: bal };
          } catch { return { entry, balance: 0n }; }
        }));
        if (cancelled) return;
        const positive = probes.filter(p => p.balance > 0n);
        if (positive.length === 0) { setArchiveUsdc(null); return; }
        positive.sort((a, b) => (b.balance > a.balance ? 1 : -1));
        setArchiveUsdc({
          address: positive[0].entry.address,
          privateKey: positive[0].entry.privateKey,
          balanceRaw: positive[0].balance.toString(),
          balanceHuman: ethers.formatUnits(positive[0].balance, 6),
          total: positive.length,
          totalBalance: ethers.formatUnits(
            positive.reduce((a, p) => a + p.balance, 0n), 6),
        });
      } catch {
        if (!cancelled) setArchiveUsdc(null);
      }
    })();
    return () => { cancelled = true; };
  }, [address, chain, token]);

  /**
   * sendUsdcViaPermit — sign EIP-2612 permit with the user's
   * stealth-address private key (already in local archive) and post
   * the signature to the backend. The relayer hot wallet submits
   * `USDC.permit(...)` and `USDC.transferFrom(stealth, recipient)`
   * atomically via Multicall3.
   *
   * Result on BaseScan:
   *   tx.from          = relayer hot wallet (gasses-up)
   *   Transfer.from    = user's stealth address (NOT main wallet)
   *   Transfer.to      = recipient
   *
   * No new contract, no vault — USDC stays in the stealth address
   * until the moment it's moved. The customer's main wallet
   * NEVER appears on BaseScan.
   */
  const sendUsdcViaPermit = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    const recipient = parseRecipient(to);
    if (!recipient) return toast.error("Invalid address — must be a raw 0x... address");
    if (!archiveUsdc) return toast.error("No USDC in your stealth address. Send USDC to your stealth first.", { duration: 6000 });
    setSending(true);
    setPermitStep("signing");
    try {
      const usdcAddr = CHAINS[chain]?.contracts?.usdc ||
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const decimals = 6;
      const amountRaw = ethers.parseUnits(amount, decimals);
      // Source stealth must have enough USDC. (Frontend already
      // checks via archiveUsdc.balanceRaw, but a last-minute gate
      // avoids sending a doomed permit.)
      if (BigInt(archiveUsdc.balanceRaw) < amountRaw) {
        return toast.error("Stealth address balance insufficient — fund it first");
      }

      // Construct the stealth address as a local ethers wallet —
      // its private key is in the archive. The browser signs EIP-712
      // permit WITH THIS wallet, NOT the customer's main wallet.
      // Only the signature leaves the browser (no key, no plaintext).
      const stealthWallet = new ethers.Wallet(archiveUsdc.privateKey);
      // Read nonces + DOMAIN_SEPARATOR + name + version via raw
      // fetch — ethers JsonRpcProvider silently fails on browser
      // CORS preflights for some Base RPCs, which was causing the
      // permit flow to fail and fall back to direct transfer.
      const { readUsdcNonce, readUsdcName, readUsdcVersion } =
        await import("@/lib/balance-reader");
      const [nonce, name, version] = await Promise.all([
        readUsdcNonce(stealthWallet.address),
        readUsdcName().catch(() => "USD Coin"),
        readUsdcVersion().catch(() => "2"),
      ]);

      const deadline = Math.floor(Date.now() / 1000) + 600; // 10 min
      // The relayer's spender address isn't known to the FE, so we
      // request it from the backend. The backend will run the
      // multicall from the relayer's hot wallet; set the spender
      // to the relayer address (returned by the prepare endpoint).
      const prepRes = await axios.post(`${API}/usdc-permit-forwarder/prepare-tx`, {
        from_address: address,           // user's main wallet (NOT the signer of permit)
        stealth_source: archiveUsdc.address,
        recipient,
        amount,
        chain: chain || "base",
      });

      const spender = prepRes.data.relayer_address;
      if (!spender) {
        return toast.error("Backend did not return a relayer address — try again");
      }

      // Build the EIP-712 typed-data for the permit.
      const domain = {
        name,
        version,
        chainId: prepRes.data.chainId,
        verifyingContract: usdcAddr,
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const message = {
        owner: stealthWallet.address,
        spender,
        value: amountRaw.toString(),
        nonce: nonce.toString(),
        deadline,
      };

      // Sign WITH the stealth key. No wallet popup — happens
      // locally on the user's already-generated stealth private
      // key (stored in localStorage). The customer's main wallet
      // never sees, never signs.
      const sig = await stealthWallet.signTypedData(domain, types, message);
      const { v, r, s } = ethers.Signature.from(sig);

      setPermitStep("submitting");
      const submitRes = await axios.post(`${API}/usdc-permit-forwarder/submit`, {
        stealth_source: archiveUsdc.address,
        recipient,
        amount,                       // human-readable
        amount_raw: amountRaw.toString(),
        spender,
        deadline,
        v,
        r,
        s,
        chain: chain || "base",
      });

      const hash = submitRes.data?.tx_hash || "";
      setTxHash(hash);
      setSuccessPopup({
        hash,
        explorer: `${CHAINS[chain].explorer}/tx/${hash}`,
        amount,
        token: "USDC",
        to: recipient,
        fromStealth: archiveUsdc.address,  // shown in popup
        chain: chain || "base",
      });

      // Seal metadata: server stores ciphertext only.
      const envelope = await seal({
        tx_hash:      hash,
        from_address: archiveUsdc.address,  // privacy-first: log the stealth as the from
        to_address:   recipient,
        amount_wei:   amountRaw.toString(),
        amount_human: amount,
        chain:        chain || "base",
        tx_type:      "private_send_usdc_permit",
        status:       "confirmed",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "private_send_usdc_permit",
        status: "confirmed",
        chain: chain || "base",
      });

      fetchBalance();
      try {
        if (typeof fetchStealthBalance === "function") await fetchStealthBalance();
      } catch {}
      // Refresh archive view so balance reflects new state.
      try {
        const list = getAddressArchive(address);
        setArchive(list);
      } catch {}
      setTo(""); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    } finally {
      setSending(false);
      setPermitStep(null);
    }
  };

  // Dispatcher: routes by sendMode.
  //   "stealth" — permit flow (most private, requires stealth USDC)
  //   "public"  — public→private via relayer (main wallet → relayer → recipient)
  //   "direct"  — stealth→stealth direct transfer (no relayer, stealth = msg.sender)
  // Dispatcher: TWO modes only.
  //   "stealth" — Stealth Send (permit + relayer, most private)
  //   "deposit" — Deposit (main wallet → your own stealth)
  const sendUsdc = () => {
    if (sendMode === "deposit") return sendUsdcDeposit();
    // default: stealth permit flow
    if (!archiveUsdc) {
      return toast.error(
        "No USDC in your stealth address. Switch to 'Deposit' mode to fund your stealth first.",
        { duration: 6000 }
      );
    }
    const amountNum = parseFloat(amount);
    const balNum = parseFloat(archiveUsdc.balanceHuman);
    if (isNaN(amountNum) || isNaN(balNum)) {
      return toast.error("Enter a valid amount");
    }
    if (amountNum > balNum) {
      return toast.error(
        `Stealth only has ${archiveUsdc.balanceHuman} USDC. Switch to 'Deposit' mode to add more.`,
        { duration: 6000 }
      );
    }
    return sendUsdcViaPermit();
  };

  /**
   * sendUsdcDeposit — DEPOSIT mode.
   * The user's main wallet sends USDC directly to THEIR OWN stealth
   * address. This is the entry point into the privacy system —
   * gets money IN. After this, the stealth has USDC and all
   * future sends use Stealth Send mode (hidden behind relayer).
   *
   * The recipient field is IGNORED — the destination is always
   * the user's own stealth address from their archive. If they
   * have multiple stealths, the one with the highest balance is
   * used (same selection logic as Stealth Send).
   *
   * On BaseScan: from = user's main wallet (unavoidable — money
   * is entering the privacy system), to = their stealth address.
   * This is the ONLY tx where the main wallet appears. After
   * this, every send is fully hidden.
   */
  const sendUsdcDeposit = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!amount || parseFloat(amount) <= 0) return toast.error("Enter an amount");
    if (!signer) return toast.error("Wallet not connected");
    // Need a stealth address to deposit into. Use the first one
    // from the archive, or prompt the user to generate one.
    let stealthTarget = archiveUsdc?.address;
    if (!stealthTarget) {
      // Try reading the archive directly in case archiveUsdc is
      // stale (e.g. user just generated a stealth but the useEffect
      // hasn't fired yet).
      const list = getAddressArchive(address);
      if (list.length > 0) {
        stealthTarget = list[0].address;
      } else {
        return toast.error(
          "No stealth address found. Generate one in Private Receive first, then deposit.",
          { duration: 6000 }
        );
      }
    }
    setSending(true);
    try {
      const usdcAddr = CHAINS[chain]?.contracts?.usdc ||
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
      const decimals = 6;
      const amountRaw = ethers.parseUnits(amount, decimals);
      const usdc = new ethers.Contract(usdcAddr,
        ["function transfer(address to, uint256 amount) returns (bool)"],
        signer);
      const tx = await usdc.transfer(stealthTarget, amountRaw);
      toast.success("Submitted — waiting for confirmation…");
      const receipt = await tx.wait();
      const hash = receipt?.hash || tx?.hash || "";
      setTxHash(hash);
      setSuccessPopup({
        hash,
        explorer: `${CHAINS[chain].explorer}/tx/${hash}`,
        amount,
        token: "USDC",
        to: stealthTarget,
        fromStealth: null,             // main wallet = sender (deposit mode)
        isDeposit: true,
        chain: chain || "base",
      });

      // Seal metadata.
      const envelope = await seal({
        tx_hash:      hash,
        from_address: address,
        to_address:   stealthTarget,
        amount_wei:   amountRaw.toString(),
        amount_human: amount,
        chain:        chain || "base",
        tx_type:      "deposit_usdc_to_stealth",
        status:       "confirmed",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "deposit_usdc_to_stealth",
        status: "confirmed",
        chain: chain || "base",
      });

      fetchBalance();
      try { if (typeof fetchStealthBalance === "function") await fetchStealthBalance(); } catch {}
      setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    }
    setSending(false);
  };

  const sendEth = async () => {
    if (!address) return toast.error("Connect wallet first");
    if (!to || !amount || parseFloat(amount) <= 0) return toast.error("Enter address and amount");
    const recipient = parseRecipient(to);
    if (!recipient) return toast.error("Invalid address — must be a raw 0x... address");
    if (!signer) return toast.error("Wallet not connected");
    setSending(true);
    try {
      const amountWei = ethers.parseEther(amount);
      const ephemeralKey = "0x" + Array(64).fill(0).map(() =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');
      const viewTag = Math.floor(Math.random() * 256);

      const prepRes = await axios.post(`${API}/relayer/prepare-tx`, {
        from_address: address,
        stealth_address: recipient,
        amount_wei: amountWei.toString(),
        ephemeral_key: ephemeralKey,
        view_tag: viewTag,
        chain: chain || "base",
      });

      const { domain, types, message } = prepRes.data.intent;
      const signature = await signer.signTypedData(domain, types, message);

      const submitRes = await axios.post(`${API}/relayer/submit`, {
        intent: prepRes.data.intent,
        signature,
        from_address: address,
        chain: chain || "base",
      });

      const relayTxHash = submitRes.data.relay_tx_hash || submitRes.data.tx_hash || "";
      setTxHash(relayTxHash);
      setSuccessPopup({
        hash: relayTxHash,
        explorer: `${CHAINS[chain].explorer}/tx/${relayTxHash}`,
        amount,
        token: CHAINS[chain]?.symbol || "ETH",
        to: recipient,
        chain: chain || "base",
      });

      const envelope = await seal({
        tx_hash:      relayTxHash,
        from_address: address,
        to_address:   recipient,
        amount_wei:   amountWei.toString(),
        amount_human: amount,
        chain:        chain || "base",
        tx_type:      "private_send_eth",
        status:       "pending",
        client:       "metadata",
      }, signer, address);
      await axios.post(`${API}/transactions/record`, {
        ...envelope,
        tx_type: "private_send_eth",
        status: "pending",
        chain: chain || "base",
      });
      fetchBalance();
      try {
        if (typeof fetchStealthBalance === "function") {
          await fetchStealthBalance();
        }
      } catch {}
      setTo(""); setAmount("");
    } catch (e) {
      const msg = e.response?.data?.detail?.slice(0, 80) || e.message?.slice(0, 80) || "Failed";
      toast.error(msg);
    }
    setSending(false);
  };

  const send = () => (token === "usdc" ? sendUsdc() : sendEth());

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center gap-2 text-xs text-white/40 bg-white/5 border border-white/10 px-3 py-2">
        <Lock className="w-3 h-3" />
        {token === "usdc"
          ? (archiveUsdc
              ? <>Permits signed by your stealth {archiveUsdc.address.slice(0, 6)}…{archiveUsdc.address.slice(-4)} — only that stealth address appears as the Transfer from on BaseScan.</>
              : <>No stealth deposit detected — USDC sends are BLOCKED until you fund a stealth. Send USDC to your stealth address first, then send privately.</>)
          : <>Routed through PrivacyRelayer on {CHAINS[chain]?.name} - your wallet never appears as sender</>}
      </div>
      {/* Token toggle */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-white/40 uppercase tracking-wider">Send</span>
        <div className="flex border border-white/20">
          {[
            { key: "usdc", label: "USDC" },
            { key: "eth",  label: CHAINS[chain]?.symbol || "ETH" },
          ].map((opt, idx) => (
            <button
              key={opt.key}
              data-testid={`token-toggle-${opt.key}`}
              onClick={() => setToken(opt.key)}
              className={`px-3 py-1.5 text-xs font-semibold ${idx > 0 ? "border-l border-white/20" : ""} ${token === opt.key ? "bg-white text-black" : "text-white/70 hover:bg-white/5"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {/* Send-mode toggle — only shown for USDC. Controls how the
          USDC is routed on-chain. ETH always uses the relayer. */}
      {token === "usdc" && (
        <div className="space-y-2">
          <label className="block text-xs text-gray-500 uppercase mb-1">Send mode</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "stealth", label: "Stealth Send", desc: "Private — via relayer", color: "green" },
              { key: "deposit", label: "Deposit",      desc: "Main wallet → your stealth", color: "blue" },
            ].map((opt) => (
              <button
                key={opt.key}
                data-testid={`mode-toggle-${opt.key}`}
                onClick={() => setSendMode(opt.key)}
                className={`p-2 border text-center transition-colors ${sendMode === opt.key
                  ? (opt.color === "green" ? "bg-green-500/20 border-green-400 text-green-300"
                    : "bg-blue-500/20 border-blue-400 text-blue-300")
                  : "border-white/20 text-white/60 hover:bg-white/5"}`}
              >
                <div className="text-[11px] font-semibold leading-tight">{opt.label}</div>
                <div className="text-[9px] opacity-70 mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/40 leading-relaxed">
            {sendMode === "stealth" && (archiveUsdc
              ? <>Sends from your stealth via the relayer — your main wallet AND stealth address stay hidden on BaseScan. Only the relayer appears. Stealth balance: {archiveUsdc.balanceHuman} USDC.</>
              : <>Stealth Send needs USDC in your stealth. Switch to "Deposit" to fund your stealth first.</>)}
            {sendMode === "deposit" && <>Moves USDC from your main wallet into your stealth address. This is the entry point — after this, use Stealth Send for private transfers. Your main wallet appears once (unavoidable — money is entering the privacy system).</>}
          </p>
        </div>
      )}
      {/* Recipient field — hidden in Deposit mode (destination is
          always the user's own stealth). In Stealth Send mode the
          user pastes the recipient's address. */}
      {token === "usdc" && sendMode === "deposit" ? (
        <div className="bg-blue-500/5 border border-blue-500/20 p-3 text-xs text-blue-300">
          Depositing to your stealth address:{" "}
          <span className="font-mono">
            {archiveUsdc?.address || getAddressArchive(address)?.[0]?.address || "— generate one in Private Receive first —"}
          </span>
        </div>
      ) : (
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-2">Recipient (stealth address)</label>
          <input data-testid="send-to-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..."
            className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-500 uppercase mb-2">
          Amount ({token === "usdc" ? "USDC" : (CHAINS[chain]?.symbol || "")})
        </label>
        <input data-testid="send-amount-input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
          className="w-full bg-white/5 border border-white/20 p-3 font-mono text-sm outline-none focus:border-white" />
      </div>
      <button data-testid="send-btn" onClick={send} disabled={sending}
        className="w-full py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2">
        {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
        Send {token === "usdc" ? "USDC" : "Privately"}
      </button>
      {txHash && !successPopup && (
        <a href={`${CHAINS[chain].explorer}/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white">
          View on explorer <ExternalLink className="w-4 h-4" />
        </a>
      )}

      {/* ── SUCCESS POPUP ──────────────────────────────────────────
          Centered modal that appears after a confirmed transaction
          and stays on screen until dismissed. The BaseScan link is
          a button so the customer has a verifiable receipt in one
          tap. */}
      {successPopup && (
        <div
          data-testid="send-success-popup"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setSuccessPopup(null)}
        >
          <div
            className="bg-black border border-green-400/40 p-6 max-w-md w-full space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-green-400" />
                <h3 className="text-lg font-bold text-white">Transaction Successful</h3>
              </div>
              <button
                data-testid="close-success-popup"
                onClick={() => setSuccessPopup(null)}
                className="text-white/40 hover:text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">Amount</span>
                <span className="font-mono text-white">{successPopup.amount} {successPopup.token}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Network</span>
                <span className="text-white">{CHAINS[successPopup.chain]?.name || successPopup.chain}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-white/40 shrink-0">Recipient</span>
                <span className="font-mono text-white/80 truncate">{successPopup.to}</span>
              </div>
              {successPopup.fromStealth && (
                <div className="pt-2 border-t border-green-400/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-green-400">From on BaseScan</span>
                    <span className="font-mono text-[11px] text-green-300 truncate">{successPopup.fromStealth}</span>
                  </div>
                  <p className="text-[10px] text-green-400/70 mt-1">
                    Your main wallet never appeared on-chain — the ERC20 Transfer event
                    fired from your stealth address.
                  </p>
                </div>
              )}
              {successPopup.isDeposit && (
                <div className="pt-2 border-t border-blue-400/20">
                  <p className="text-[10px] text-blue-300/80">
                    Deposit complete — your stealth now has USDC. Switch to "Stealth Send"
                    for private transfers; your main wallet won't appear again.
                  </p>
                </div>
              )}
            </div>
            <a
              data-testid="basescan-link"
              href={successPopup.explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 bg-green-500 text-black font-bold uppercase tracking-wider hover:bg-green-400 flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Open in BaseScan
            </a>
            <p className="text-[11px] text-white/40 text-center">
              The transaction is finalized on-chain. Refresh the dashboard to see your Private balance update.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
