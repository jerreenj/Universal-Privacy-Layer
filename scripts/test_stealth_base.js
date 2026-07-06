// Live Base mainnet stealth-send test. CommonJS — no top-level await.
const fs = require('fs');
const path = require('path');
const { ethers } = require(path.resolve('frontend/node_modules/ethers'));
const { secp256k1 } = require(path.resolve('frontend/node_modules/@noble/curves/secp256k1'));
const { execSync } = require('child_process');

const { ProjectivePoint } = secp256k1;
const RPC = 'https://mainnet.base.org';
const DEPLOYER = '0x3f44A6451439673D95082A1337045a25ec275394';
const BACKEND  = 'https://www.privacycloak.in';
// Curve order n (used to reduce the scalar mod n)
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

function compressedPubFromPriv(privKey /* 0x-prefixed hex */) {
  const privBytes = Buffer.from(privKey.slice(2), 'hex');
  return '0x' + Buffer.from(secp256k1.getPublicKey(privBytes, true)).toString('hex');
}

async function main() {
  // Load deployer key
  const env = fs.readFileSync('contracts/.env', 'utf8');
  const pk = env.split('\n').find(l => l.startsWith('DEPLOYER_PRIVATE_KEY='))
    .split('=', 2)[1].trim().replace(/^['"]|['"]$/g, '');
  console.log(`Deployer addr:  ${DEPLOYER}`);
  console.log(`Deployer pk:    ${pk.slice(0, 6)}…${pk.slice(-4)}  (NOT printing full)`);

  // 1) Generate meta-address (spending + viewing keypair, both fresh)
  const spender = ethers.Wallet.createRandom();
  const viewer  = ethers.Wallet.createRandom();
  const spendPubHex = compressedPubFromPriv(spender.privateKey);
  const viewPubHex  = compressedPubFromPriv(viewer.privateKey);
  const metaAddress = `st:eth:${spender.address.slice(2)}${viewer.address.slice(2)}`;
  console.log(`\nMeta address:    ${metaAddress}`);
  console.log(`  spend pub:      ${spendPubHex}`);
  console.log(`  view  pub:      ${viewPubHex}`);

  // 2) Generate ephemeral keypair
  const ephemeral = ethers.Wallet.createRandom();
  const ephPubHex = compressedPubFromPriv(ephemeral.privateKey);

  // 3) ECDH: shared_secret = ephemeralPriv * viewPubPoint
  //    sharedX = x-coordinate of resulting point
  //    Use ethers' SigningKey.computeSharedSecret (x-coord only, EIP-5564 friendly)
  const viewerSk = new ethers.SigningKey(viewer.privateKey);
  const sharedHex = viewerSk.computeSharedSecret(ephPubHex);     // 32-byte x-coord hex string
  const sharedX = Buffer.from(sharedHex.slice(2), 'hex');        // 32 bytes

  // 4) EIP-5564 stealth pubkey = viewPub + keccak256(sharedX) * G
  const sharedHash = ethers.keccak256(sharedX);
  // The scalar must be mod curve order
  const scalar = BigInt(sharedHash) % N;
  // viewPoint from compressed pub (needs bytes, not '0x') — strip prefix
  const viewPoint = ProjectivePoint.fromHex(viewPubHex.slice(2));
  const scalarPoint = ProjectivePoint.BASE.multiply(scalar);
  const stealthPoint = viewPoint.add(scalarPoint);
  const stealthCompressedHex = '0x' + Buffer.from(stealthPoint.toRawBytes(true)).toString('hex');
  const stealthAddress = ethers.computeAddress(stealthCompressedHex);
  console.log(`Stealth addr:    ${stealthAddress}`);
  console.log(`Ephemeral pub:   ${ephPubHex}`);
  console.log(`View tag:        0x${sharedX[0].toString(16).padStart(2, '0')}  (first byte of sharedX)`);

  // 5) cast send 0.0001 ETH from deployer to the stealth address on Base
  const valueWei = '100000000000000';   // 0.0001 ETH
  console.log(`\nSending 0.0001 ETH on Base from deployer → stealth…`);
  const cmd = `cast send --rpc-url ${RPC} --private-key ${pk.slice(2)} ${stealthAddress} --value ${valueWei} --gas-limit 30000 --json`;
  console.log(`  gas-limit 30,000  estimate cost: ~0.00020 ETH`);
  let txHash;
  try {
    const out = execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
    // `--json` returns a single JSON object on stdout
    const parsed = JSON.parse(out.trim());
    txHash = parsed.transactionHash;
    if (!txHash) throw new Error('no transactionHash in cast output:\n' + out);
  } catch (e) {
    console.error('cast send failed:');
    console.error(e.stderr?.slice(-800) || e.stdout?.slice(-800) || e.message);
    process.exit(1);
  }

  console.log(`\n✓ Tx hash:        ${txHash}`);
  console.log(`✓ Basescan URL:   https://basescan.org/tx/${txHash}`);

  // 6) POST announcement to backend
  // view_tag is `0x` + 2 hex chars (FastAPI base model expects str)
  const viewTagHex = (sharedX[0] >>> 0).toString(16).padStart(2, '0');
  const announce = {
    sender_address: DEPLOYER,
    stealth_address: stealthAddress,
    ephemeral_pub: ephPubHex,
    view_tag: viewTagHex,
    amount_wei: valueWei,
    chain: 'base',
    tx_hash: txHash,
  };
  console.log(`\nPOST ${BACKEND}/api/stealth/announce …`);
  const postRes = await fetch(`${BACKEND}/api/stealth/announce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(announce),
  });
  const postBody = await postRes.json().catch(() => null);
  console.log(`  status: ${postRes.status}`);
  console.log(`  body:   ${JSON.stringify(postBody).slice(0, 500)}`);

  // 7) GET scan receiver view
  console.log(`\nGET ${BACKEND}/api/stealth/scan/${DEPLOYER} …`);
  const scanRes = await fetch(`${BACKEND}/api/stealth/scan/${DEPLOYER}`);
  const scanBody = await scanRes.json().catch(() => null);
  console.log(`  status: ${scanRes.status}`);
  console.log(`  body:   ${JSON.stringify(scanBody).slice(0, 600)}`);

  // 8) GET all announcements on Base
  console.log(`\nGET ${BACKEND}/api/stealth/announcements?chain=base&limit=5 …`);
  const annRes = await fetch(`${BACKEND}/api/stealth/announcements?chain=base&limit=5`);
  const annBody = await annRes.json().catch(() => null);
  console.log(`  status:  ${annRes.status}`);
  if (annBody?.announcements) {
    console.log(`  count:   ${annBody.announcements.length}`);
    console.log(`  ours?:   ${annBody.announcements.some(a => a.tx_hash === txHash)}`);
    if (annBody.announcements.length) {
      console.log(`  first:   ${JSON.stringify(annBody.announcements[0]).slice(0, 300)}`);
    }
  } else {
    console.log(`  body:    ${JSON.stringify(annBody).slice(0, 600)}`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Tx:        ${txHash}`);
  console.log(`Basescan:  https://basescan.org/tx/${txHash}`);
  console.log(`Meta:      ${metaAddress}`);
  console.log(`\nReal ETH moved ~ $0.20  (0.0001 ETH value + gas)`);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  console.error(e.stack);
  process.exit(99);
});
