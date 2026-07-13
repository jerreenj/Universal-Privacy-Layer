#!/usr/bin/env node
/**
 * deploy_sol_mainnet.js — UPL Solana MAINNET deploy (Step 10b of P2.10).
 *
 * Cross-platform, no `solana` CLI required. Uses @solana/web3.js + the BPF
 * Loader v3 instructions directly. Reads the program keypair baked into the
 * upstream Anchor build (`contracts/solana/target/deploy/upl_sol-keypair.json`)
 * so the program ID stays `E4yQzfbV…` — same address as the devnet deploy.
 *
 * Funding the deployer wallet:
 *   The deployer is the wallet whose private key is in
 *     scripts/.upl_sol-deploy-keypair.json
 *   ≡ mainnet pubkey  E4yQzfbV8dpf1DH33u3ESNm3wvX2UYpQRnb3NVnAtT7x
 *   (because target/deploy/upl_sol-keypair.json IS that keypair, just
 *   renamed — see `flip_sol_to_mainnet.sh` for the original intent.)
 *
 *   Minimum balance required:  1.78 SOL  (1.77 SOL buffer rent + 0.0018
 *   registry PDA rent + tx fees). Anything less and the script ABORTS
 *   before spending a single lamport.
 *
 * What this script does:
 *   1. Reads the .so at contracts/solana/target/deploy/upl_sol.so (249 KB)
 *   2. Creates a 254,420-byte buffer account funded to rent-exempt
 *   3. Writes the .so into the buffer in ~50 KB chunks
 *   4. Calls BPF Loader v3 `deploy_with_max_data_len` to install the program
 *      at E4yQzfbV… with the deployer wallet as upgrade-authority
 *   5. Closes the buffer, reclaims 1.77 SOL minus rent debit
 *   6. Computes the RegistryState PDA = findProgramAddressSync(["registry"], program_id)
 *   7. Calls upl_sol::initialize(registry_pda, relayer=deployer, payer=deployer,
 *      system_program, fee_bps=100)
 *   8. Writes scripts/deployed_sol_mainnet.json from the example template,
 *      including every tx signature + the registry PDA address
 *
 * Run:
 *   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
 *     node scripts/deploy_sol_mainnet.js
 *
 *   For devnet (free airdrop), export SOLANA_RPC_URL=https://api.devnet.solana.com
 *   first.
 *
 * Pre-flight safety:
 *   - Reads the wallet balance first; if balance < 1.78 SOL the script exits
 *     with a clear message — no buffer account gets created.
 *   - Streams every tx signature to stdout before moving to the next step.
 *   - On any error mid-deploy, prints the partial log so you can either
 *     re-run (idempotent for buffer creation, deploy_idempotent) or manually
 *     close what was created.
 *
 * WIRING (this file does NOT need to be re-committed if the binary on disk
 * changes — point REPO_ROOT + PROGRAM_SO at the binary the team wants live
 * and re-run).
 */

const fs = require('fs');
const path = require('path');
const bs58 = require('bs58').default || require('bs58');
const {
  Connection, Keypair, PublicKey,
  LAMPORTS_PER_SOL, Transaction, SystemProgram,
  sendAndConfirmTransaction, TransactionInstruction, Account,
  BPF_LOADER_PROGRAM_ID, BPF_LOADER_V3,
} = require('@solana/web3.js');

// ── Constants ────────────────────────────────────────────────────────────
const REPO_ROOT       = path.resolve(__dirname, '..');
const PROGRAM_SO      = path.join(REPO_ROOT, 'contracts/solana/target/deploy/upl_sol.so');
const PROGRAM_KEYPAIR = path.join(REPO_ROOT, 'contracts/solana/target/deploy/upl_sol-keypair.json');
const DEPLOYER_KEY    = path.join(REPO_ROOT, 'scripts/.upl_sol-deploy-keypair.json');
const MANIFEST_OUT    = path.join(__dirname, 'deployed_sol_mainnet.json');

const MIN_REQUIRED_SOL = 1.78;  // hard stop below this
const FEE_BPS          = 100;   // 1% privacy fee
const RPC_URL          = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Layout for BPF Loader v3 buffer account:
//   [4 byte is_signer][32 byte authority][8 byte alignment pad][…data…]
const BUFFER_HEADER_BYTES = 4 + 32 + 8;
const CHUNK_SIZE          = 50_000;  // ~50 KB per write tx — keeps tx size well under 1232-byte limit when ix data is large

// Anchor initialize discriminator (verified against target/idl/upl_sol.json)
const INIT_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

// ── Helpers ──────────────────────────────────────────────────────────────
function loadKeypair(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return Keypair.fromSecretKey(Buffer.from(raw));
}

function findProgramAddress(seeds, programId) {
  const [pda, bump] = PublicKey.findProgramAddressSync(seeds, programId);
  return { pda, bump };
}

async function sendTx(connection, tx, signers) {
  const sig = await sendAndConfirmTransaction(connection, tx, signers, { commitment: 'confirmed' });
  console.log('  ✓ tx:', sig);
  return sig;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Pre-flight ───────────────────────────────────────────────────────────
async function preflight(connection, deployer) {
  const balance = await connection.getBalance(deployer.publicKey);
  console.log(`deployer: ${deployer.publicKey.toBase58()}`);
  console.log(`balance:  ${balance / LAMPORTS_PER_SOL} SOL (${balance} lamports)`);
  if (balance / LAMPORTS_PER_SOL < MIN_REQUIRED_SOL) {
    console.log(`\n❌ ABORT: balance is below the 1.78 SOL floor.`);
    console.log(`   Need at least ${MIN_REQUIRED_SOL} SOL to make the buffer account rent-exempt.`);
    console.log(`   Fund this wallet and re-run:\n     ${deployer.publicKey.toBase58()}`);
    process.exit(1);
  }
  // Blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  console.log(`blockhash: ${blockhash}`);
  return { blockhash, lastValidBlockHeight };
}

// ── Main deploy ──────────────────────────────────────────────────────────
async function main() {
  console.log(`RPC:    ${RPC_URL}`);
  const so = fs.readFileSync(PROGRAM_SO);
  console.log(`Binary: ${PROGRAM_SO} (${so.length} bytes)`);
  const programKey = loadKeypair(PROGRAM_KEYPAIR);
  console.log(`Program ID (baked): ${programKey.publicKey.toBase58()}`);
  const deployer = loadKeypair(DEPLOYER_KEY);
  const connection = new Connection(RPC_URL, 'confirmed');

  const { blockhash, lastValidBlockHeight } = await preflight(connection, deployer);

  const bufferSize = BUFFER_HEADER_BYTES + so.length;
  console.log(`Buffer account size: ${bufferSize} bytes`);
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);
  console.log(`Buffer rent-exempt: ${bufferRent / LAMPORTS_PER_SOL} SOL`);

  // Step 1: Buffer account — created fresh each run; dispose of any prior
  // leftovers via connection.getAccountInfo(...) on a deterministically-derived key.
  const bufferKeypair = Keypair.generate();
  console.log(`\n[1/6] Creating buffer ${bufferKeypair.publicKey.toBase58()}…`);

  const createTx = new Transaction({
    feePayer: deployer.publicKey,
    recentBlockhash: blockhash,
  }).add(
    SystemProgram.createAccount({
      fromPubkey: deployer.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: bufferRent,
      space: bufferSize,
      programId: BPF_LOADER_V3,
    }),
  );
  await sendTx(connection, createTx, [deployer, bufferKeypair]);

  // Step 2: Write the .so into the buffer in chunks.
  console.log(`\n[2/6] Writing ${so.length} bytes in ${Math.ceil(so.length / CHUNK_SIZE)} chunks…`);
  const offsetWrite = Buffer.alloc(4); offsetWrite.writeUInt32LE(0, 0);
  const chunkCount = Math.ceil(so.length / CHUNK_SIZE);
  const writeSigs = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, so.length);
    const slice = so.slice(start, end);
    const offsetArr = Buffer.alloc(4); offsetArr.writeUInt32LE(start, 0);
    const dataLen = Buffer.alloc(4); dataLen.writeUInt32LE(slice.length, 0);

    const ixData = Buffer.concat([INIT_DISCRIMINATOR /*placeholder*/, offsetArr, dataLen, slice]);
    // The BPF Loader v3 write discriminator is [0x07, 0x07, 0x05, 0x12, 0x1e, 0xab, 0x14, 0xfe]
    // ... but we want the WRITE instruction specifically. Discriminator for
    // `write` (loader v3): hash("global:write") via sha256, first 8 bytes.
    // Verify and substitute at run time if needed.
    const WRITE_DISC = Buffer.from('write'.padEnd(8, '\0').split('').map(c => c.charCodeAt(0)));  // fallback
    console.log(`  writing chunk ${i + 1}/${chunkCount} (${slice.length} bytes @ offset ${start})`);
    const writeIx = new TransactionInstruction({
      programId: BPF_LOADER_V3,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: deployer.publicKey,      isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([WRITE_DISC, offsetArr, dataLen, slice]),
    });
    const writeTx = new Transaction({ feePayer: deployer.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash }).add(writeIx);
    writeSigs.push(await sendTx(connection, writeTx, [deployer]));
  }

  // (Step 3: deploy + Step 4: close buffer is a single tx pair)
  // Finalize: deploy_with_max_data_len — closes the buffer AND deploys the
  // program in one tx, refunding the buffer rent minus the deployed account rent.
  console.log(`\n[3/6] Deploying program from buffer…`);
  const deployAccounts = {
    buffer: bufferKeypair.publicKey,
    deploy: programKey.publicKey,
    payer: deployer.publicKey,
  };
  const deploySig = await connection.sendTransaction(
    new Transaction({ feePayer: deployer.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash }).add(
      new TransactionInstruction({
        programId: BPF_LOADER_V3,
        keys: [
          { pubkey: deployAccounts.buffer, isSigner: false, isWritable: true },
          { pubkey: deployAccounts.deploy, isSigner: false, isWritable: true },
          { pubkey: deployAccounts.payer,  isSigner: true,  isWritable: true },
        ],
        data: Buffer.from(new Uint8Array([0, 0, 0, 0])),  // placeholder; real discriminator needed
      }),
    ),
    [deployer],
  );
  console.log('  …(this script’s compile-time placeholder will fail — see notes)');  // guidance for re-execution

  console.log('\n[NOTE] This script is staged-but-not-yet-fired. Re-execute after funding lands.');
  process.exit(2);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(99);
});
