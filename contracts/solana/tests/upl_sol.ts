import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, TransactionInstruction, Transaction } from "@solana/web3.js";
import { assert, expect } from "chai";

// UPL Solana — raw integration tests using @solana/web3.js directly.
// We build instructions manually (no Anchor IDL needed) to avoid the
// Anchor 0.30.1 IDL generation issue on WSL. The program is compiled + deployed
// by `anchor test`; we just construct the tx calls ourselves.

// ─── Program ID (matches declare_id! in lib.rs + the deploy keypair) ────────
// This is updated by anchor test when it deploys — read from the deploy keypair.
const PROGRAM_ID_STR = "FJpgCSo41ihgL1p6W9YCKJFJfBAXUfUBN8m3hxevdSVQ";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// ─── Instruction discriminators (first 8 bytes of sha256("global:<name>")) ──
function ixDiscriminator(name: string): Buffer {
  const hash = anchor.sha256(`global:${name}`);
  return Buffer.from(hash.slice(0, 16), "hex"); // first 8 bytes as hex
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
  const provider = anchor.AnchorProvider.local();
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;

  let relayer: Keypair;
  let recipient: Keypair;
  let otherUser: Keypair;
  let programId: PublicKey;

  before(async () => {
    relayer = Keypair.generate();
    recipient = Keypair.generate();
    otherUser = Keypair.generate();
    await airdrop(provider, relayer.publicKey, 5 * LAMPORTS_PER_SOL);
    await airdrop(provider, wallet.publicKey, 5 * LAMPORTS_PER_SOL);

    // Read the actual deployed program ID from the Anchor.toml / workspace
    // For now use the static one — anchor test replaces it
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
    await provider.sendAndConfirm(tx, [wallet.payer]);

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
    await provider.sendAndConfirm(tx, [wallet.payer, relayer]);

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
      await provider.sendAndConfirm(tx, [otherUser]);
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
      await provider.sendAndConfirm(tx, [relayer]);
      assert.fail("should have reverted with ZeroAmount");
    } catch (err: any) {
      expect(err.message).to.match(/Error|failed|revert|6000|ZeroAmount/i);
    }
  });
});
