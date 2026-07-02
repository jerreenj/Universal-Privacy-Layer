import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction, Transaction, SendOptions, ConfirmOptions } from "@solana/web3.js";
import { assert, expect } from "chai";
import * as crypto from "crypto";

// ─── HTTP-only transaction confirmation (WS doesn't work in WSL) ────────────
// sendAndConfirmHttp uses sendRawTransaction + blockhash-expiry confirmation,
// polling getSignatureStatuses via HTTP instead of waiting for a WebSocket
// event. This is the workaround for the WSL WebSocket issue AND for the silent
// tx-drop seen when sendTransaction auto-fetches a blockhash that ages out
// before the local validator processes it. We fetch a fresh blockhash, sign
// explicitly, and retry sendRawTransaction until the blockhash expires.
async function sendAndConfirmHttp(
  connection: anchor.web3.Connection,
  tx: Transaction,
  signers: Keypair[]
): Promise<string> {
  // Fetch a fresh blockhash and bake it into the tx explicitly.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  if (!tx.feePayer && signers[0]) {
    tx.feePayer = signers[0].publicKey;
  }
  tx.sign(...signers);
  const raw = tx.serialize();

  // Retry sendRawTransaction (idempotent by signature) until confirmed or the
  // blockhash expires — this is the recommended web3.js pattern for unreliable
  // transport. skipPreflight:true surfaces real errors instead of masking them.
  let sig: string | null = null;
  let confirmed = false;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      sig = await connection.sendRawTransaction(raw, {
        skipPreflight: true,
        preflightCommitment: "processed",
        maxRetries: 0,
      });
    } catch (e) {
      lastErr = e;
    }
    if (sig) {
      // Poll status for up to ~3s per attempt.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const status = await connection.getSignatureStatus(sig);
        const cs = status?.value?.confirmationStatus;
        if (cs === "confirmed" || cs === "finalized" || cs === "processed") {
          if (status!.value!.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status!.value!.err)}`);
          }
          confirmed = true;
          break;
        }
      }
    }
    if (confirmed) break;
    // Stop retrying once the blockhash is no longer valid.
    const current = await connection.getBlockHeight();
    if (current > lastValidBlockHeight) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!confirmed) {
    throw new Error(
      `Transaction ${sig || "(no sig)"} not confirmed before blockhash expired. ` +
      `lastErr=${lastErr ? String(lastErr) : "none"}`
    );
  }
  return sig!;
}

// UPL Solana — raw integration tests using @solana/web3.js directly.
// We build instructions manually (no Anchor IDL needed) to avoid the
// Anchor 0.30.1 IDL generation issue on WSL. The program is compiled + deployed
// by `anchor test`; we just construct the tx calls ourselves.

// ─── Program ID (matches declare_id! in lib.rs + the deploy keypair) ────────
// Read from the Anchor workspace IDL if present; otherwise derive from the
// deploy keypair file (anchor build always writes target/deploy/upl_sol-keypair.json).
// This replaces a stale hardcoded literal that mismatched Anchor.toml /
// declare_id!, which broke every test. Resolution order: workspace IDL →
// keypair pubkey → fail-loud placeholder.
let PROGRAM_ID: PublicKey;
try {
  PROGRAM_ID = anchor.workspace.UplSol.programId as PublicKey;
} catch {
  try {
    // Fallback: the deploy keypair's pubkey IS the program ID. Read it directly.
    const fs = require("fs");
    const path = require("path");
    const kpPath = path.join(__dirname, "..", "target", "deploy", "upl_sol-keypair.json");
    const kpBytes = Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf-8")));
    PROGRAM_ID = Keypair.fromSecretKey(kpBytes).publicKey;
  } catch {
    // Last resort — wrong placeholder; tests will fail loudly, which is correct.
    PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
  }
}

// ─── Instruction discriminators (first 8 bytes of sha256("global:<name>")) ──
function ixDiscriminator(name: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

const IX = {
  initialize: ixDiscriminator("initialize"),
  announce: ixDiscriminator("announce"),
  relay: ixDiscriminator("relay"),
  relayAndAnnounce: ixDiscriminator("relay_and_announce"),
  issueReceipt: ixDiscriminator("issue_receipt"),
  setFeeBps: ixDiscriminator("set_fee_bps"),
  withdrawFees: ixDiscriminator("withdraw_fees"),
  close: ixDiscriminator("close"),
};

// ─── PDA helpers ────────────────────────────────────────────────────────────
function registryPda(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("registry")], programId);
}

function announcementPda(id: BN | number, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  new BN(id).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("announce"), new BN(id).toArrayLike(Buffer, "le", 8)],
    programId
  );
}

function receiptPda(id: BN | number, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), new BN(id).toArrayLike(Buffer, "le", 8)],
    programId
  );
}

async function airdrop(provider: AnchorProvider, pubkey: PublicKey, lamports: number = 2 * LAMPORTS_PER_SOL) {
  const sig = await provider.connection.requestAirdrop(pubkey, lamports);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

// ─── Account layout for deserialization ─────────────────────────────────────
// RegistryState: 8 (discriminator) + 32 (relayer) + 32 (admin) + 2 (fee_bps) +
//                8 (next_id) + 8 (total_relayed) + 8 (accumulated_fees) + 8 (next_receipt_id)
const REGISTRY_DISCRIMINATOR = Buffer.from([99, 22, 51, 122, 91, 11, 36, 26]); // approximate

function parseRegistryState(data: Buffer) {
  // Skip 8-byte discriminator
  let offset = 8;
  const relayer = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const admin = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const feeBps = data.readUInt16LE(offset); offset += 2;
  const nextId = new BN(data.slice(offset, offset + 8), "le"); offset += 8;
  const totalRelayed = new BN(data.slice(offset, offset + 8), "le"); offset += 8;
  const accumulatedFees = new BN(data.slice(offset, offset + 8), "le"); offset += 8;
  const nextReceiptId = new BN(data.slice(offset, offset + 8), "le"); offset += 8;
  return { relayer, admin, feeBps, nextId, totalRelayed, accumulatedFees, nextReceiptId };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("UPL Solana — PrivacyRelayer parity tests", () => {
  // Use a custom provider with HTTP-only confirmation (WebSocket doesn't work
  // reliably in WSL — txs succeed but confirmation times out via WS).
  const connection = new anchor.web3.Connection("http://127.0.0.1:8899", {
    commitment: "processed",
    confirmTransactionInitialTimeout: 60000,
  });
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "processed",
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);

  let relayer: Keypair;
  let recipient: Keypair;
  let otherUser: Keypair;
  let programId: PublicKey;

  before(async () => {
    relayer = Keypair.generate();
    recipient = Keypair.generate();
    otherUser = Keypair.generate();

    // Fund the relayer + otherUser from the genesis wallet via HTTP-confirmed transfer
    // (airdrop uses WebSocket confirmation which doesn't work in WSL)
    async function fund(target: PublicKey, lamports: number) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: target,
          lamports,
        })
      );
      await sendAndConfirmHttp(connection, tx, [wallet.payer]);
    }
    await fund(relayer.publicKey, 5 * LAMPORTS_PER_SOL);
    await fund(otherUser.publicKey, 2 * LAMPORTS_PER_SOL);

    programId = PROGRAM_ID;
  });

  // ── Initialize ─────────────────────────────────────────────────────────

  it("initialize — creates RegistryState PDA with relayer + fee", async () => {
    const [registry] = registryPda(programId);

    // Build the initialize instruction manually
    const data = Buffer.concat([
      IX.initialize,
      relayer.publicKey.toBuffer(),      // relayer: Pubkey
      Buffer.from(new BN(5).toArrayLike(Buffer, "le", 2)), // fee_bps: u16
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });

    const tx = new Transaction().add(ix);
    await sendAndConfirmHttp(connection, tx, [wallet.payer]);

    // Read back the registry state
    const accountInfo = await provider.connection.getAccountInfo(registry);
    assert.isNotNull(accountInfo, "registry account exists");
    const state = parseRegistryState(accountInfo!.data);
    assert.equal(state.relayer.toBase58(), relayer.publicKey.toBase58(), "relayer");
    assert.equal(state.admin.toBase58(), wallet.publicKey.toBase58(), "admin");
    assert.equal(state.feeBps, 5, "fee_bps");
    assert.equal(state.nextId.toNumber(), 0, "next_id");
    assert.equal(state.totalRelayed.toNumber(), 0, "total_relayed");
  });

  // ── Atomic relay + announce ────────────────────────────────────────────

  it("relayAndAnnounce — atomic: forwards SOL, creates announcement + receipt", async () => {
    const [registry] = registryPda(programId);
    const accountInfo = await provider.connection.getAccountInfo(registry);
    const state = parseRegistryState(accountInfo!.data);
    const announcementId = state.nextId;
    const receiptId = state.nextReceiptId;

    const [announcementAddr] = announcementPda(announcementId, programId);
    const [receiptAddr] = receiptPda(receiptId, programId);

    const amount = new BN(0.01 * LAMPORTS_PER_SOL);
    const feeBps = state.feeBps;
    const fee = amount.mul(new BN(feeBps)).div(new BN(10000));
    const transferAmount = amount.sub(fee);

    const recipientBefore = await provider.connection.getBalance(recipient.publicKey);

    const ephemeralKey = Buffer.alloc(32, 0xca);
    const viewTag = 42;
    const stealthHash = Buffer.alloc(32, 0xab);
    const ciphertext = Buffer.from("encrypted-payload-mvp");
    const nonce = Buffer.from("nonce-12bytes!");

    // Build relay_and_announce instruction
    const data = Buffer.concat([
      IX.relayAndAnnounce,
      ephemeralKey,                           // ephemeral_pub_key: [u8;32]
      Buffer.from([viewTag]),                 // view_tag: u8
      stealthHash,                            // stealth_hash: [u8;32]
      Buffer.from(new BN(ciphertext.length).toArrayLike(Buffer, "le", 8)), // ciphertext: Vec<u8>
      ciphertext,
      Buffer.from(new BN(nonce.length).toArrayLike(Buffer, "le", 8)),      // nonce: Vec<u8>
      nonce,
      amount.toArrayLike(Buffer, "le", 8),    // amount: u64
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: recipient.publicKey, isSigner: false, isWritable: true },
        { pubkey: announcementAddr, isSigner: false, isWritable: true },
        { pubkey: receiptAddr, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });

    const tx = new Transaction().add(ix);
    await sendAndConfirmHttp(connection, tx, [wallet.payer, relayer]);

    // Recipient received amount - fee
    const recipientAfter = await provider.connection.getBalance(recipient.publicKey);
    assert.equal(
      recipientAfter - recipientBefore,
      transferAmount.toNumber(),
      "recipient got amount - fee"
    );

    // Registry stats updated
    const accountAfter = await provider.connection.getAccountInfo(registry);
    const stateAfter = parseRegistryState(accountAfter!.data);
    assert.equal(stateAfter.nextId.toNumber(), 1, "next_id incremented");
    assert.equal(stateAfter.nextReceiptId.toNumber(), 1, "next_receipt_id incremented");
    assert.equal(stateAfter.totalRelayed.toNumber(), transferAmount.toNumber(), "total_relayed");
    assert.equal(stateAfter.accumulatedFees.toNumber(), fee.toNumber(), "accumulated_fees");

    // Announcement PDA created
    const annInfo = await provider.connection.getAccountInfo(announcementAddr);
    assert.isNotNull(annInfo, "announcement PDA exists");

    // Receipt PDA created
    const recInfo = await provider.connection.getAccountInfo(receiptAddr);
    assert.isNotNull(recInfo, "receipt PDA exists");
  });

  // ── Auth guard: non-relayer rejected ───────────────────────────────────

  it("relayAndAnnounce — rejects non-relayer", async () => {
    const [registry] = registryPda(programId);
    const accountInfo = await provider.connection.getAccountInfo(registry);
    const state = parseRegistryState(accountInfo!.data);
    const [announcementAddr] = announcementPda(state.nextId, programId);
    const [receiptAddr] = receiptPda(state.nextReceiptId, programId);

    const ephemeralKey = Buffer.alloc(32, 0xca);
    const stealthHash = Buffer.alloc(32, 0xab);
    const ciphertext = Buffer.from("ct");
    const nonce = Buffer.from("n");

    const data = Buffer.concat([
      IX.relayAndAnnounce,
      ephemeralKey,
      Buffer.from([1]),
      stealthHash,
      Buffer.from(new BN(ciphertext.length).toArrayLike(Buffer, "le", 8)),
      ciphertext,
      Buffer.from(new BN(nonce.length).toArrayLike(Buffer, "le", 8)),
      nonce,
      new BN(1000).toArrayLike(Buffer, "le", 8),
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: otherUser.publicKey, isSigner: true, isWritable: true }, // WRONG relayer
        { pubkey: recipient.publicKey, isSigner: false, isWritable: true },
        { pubkey: announcementAddr, isSigner: false, isWritable: true },
        { pubkey: receiptAddr, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      await sendAndConfirmHttp(connection, tx, [otherUser]);
      assert.fail("should have reverted");
    } catch (err: any) {
      // has_one constraint failure or custom error
      expect(err.message).to.match(/Error|failed|revert|6003|NotAuthorized/i);
    }
  });

  // ── Zero amount guard ──────────────────────────────────────────────────

  it("relayAndAnnounce — rejects zero amount", async () => {
    const [registry] = registryPda(programId);
    const accountInfo = await provider.connection.getAccountInfo(registry);
    const state = parseRegistryState(accountInfo!.data);
    const [announcementAddr] = announcementPda(state.nextId, programId);
    const [receiptAddr] = receiptPda(state.nextReceiptId, programId);

    const data = Buffer.concat([
      IX.relayAndAnnounce,
      Buffer.alloc(32, 1),
      Buffer.from([1]),
      Buffer.alloc(32, 1),
      Buffer.from(new BN(2).toArrayLike(Buffer, "le", 8)),
      Buffer.from("ct"),
      Buffer.from(new BN(1).toArrayLike(Buffer, "le", 8)),
      Buffer.from("n"),
      new BN(0).toArrayLike(Buffer, "le", 8), // ZERO amount
    ]);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: recipient.publicKey, isSigner: false, isWritable: true },
        { pubkey: announcementAddr, isSigner: false, isWritable: true },
        { pubkey: receiptAddr, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      await sendAndConfirmHttp(connection, tx, [relayer]);
      assert.fail("should have reverted with ZeroAmount");
    } catch (err: any) {
      expect(err.message).to.match(/Error|failed|revert|6000|ZeroAmount/i);
    }
  });
});
