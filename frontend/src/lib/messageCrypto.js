/**
 * True Wallet-to-Wallet E2E Encryption using ECDH (secp256k1)
 *
 * Flow:
 *   1. User signs a deterministic message → SHA-256 of signature = messaging private key
 *   2. Public key derived from that private key = messaging public key (registered on backend)
 *   3. Sender:  ephemeral keypair → ECDH(ephPriv, recipientPub) → AES-GCM encrypt
 *   4. Receiver: ECDH(ownPriv, ephPub) → AES-GCM decrypt
 *
 * The server NEVER sees plaintext or private keys.
 */
import * as secp from "@noble/secp256k1";

const SIGN_MESSAGE = "UPL Encrypted Messaging — Sign to derive your messaging key. This does NOT cost gas.";

/** Convert hex string (with or without 0x) to Uint8Array */
function hexToBytes(hex) {
  const h = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  return bytes;
}

/** Convert Uint8Array to hex string (no 0x prefix) */
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Derive messaging keypair from wallet signature.
 * @param {ethers.Signer} signer — connected wallet signer
 * @returns {{ privateKey: Uint8Array, publicKey: string }} — publicKey is hex (compressed, 33 bytes)
 */
export async function deriveMessagingKeys(signer) {
  const signature = await signer.signMessage(SIGN_MESSAGE);
  // Hash the signature to get a 32-byte private key
  const sigBytes = hexToBytes(signature);
  const hashBuffer = await crypto.subtle.digest("SHA-256", sigBytes);
  const privateKey = new Uint8Array(hashBuffer);
  const publicKey = bytesToHex(secp.getPublicKey(privateKey, true)); // compressed 33-byte
  return { privateKey, publicKey };
}

/**
 * Encrypt a message for a recipient.
 * Uses ECIES: ephemeral ECDH → AES-256-GCM.
 *
 * @param {string} plaintext
 * @param {string} recipientPubHex — recipient's messaging public key (compressed hex)
 * @returns {{ ciphertext: string, ephemeralPub: string, nonce: string }}
 *   All values are hex-encoded.
 */
export async function encryptMessage(plaintext, recipientPubHex) {
  // 1. Generate ephemeral keypair
  const ephPriv = secp.utils.randomSecretKey();
  const ephPub = secp.getPublicKey(ephPriv, true); // compressed

  // 2. ECDH shared secret
  const recipientPubBytes = hexToBytes(recipientPubHex);
  const sharedRaw = secp.getSharedSecret(ephPriv, recipientPubBytes, true); // compressed point
  // Derive AES key from shared secret via SHA-256
  const aesKeyBuf = await crypto.subtle.digest("SHA-256", sharedRaw);
  const aesKey = await crypto.subtle.importKey("raw", aesKeyBuf, "AES-GCM", false, ["encrypt"]);

  // 3. Encrypt with AES-256-GCM
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, encoded);

  return {
    ciphertext: bytesToHex(new Uint8Array(encrypted)),
    ephemeralPub: bytesToHex(ephPub),
    nonce: bytesToHex(nonce),
  };
}

/**
 * Decrypt a message using the recipient's private key.
 *
 * @param {string} ciphertextHex
 * @param {string} ephemeralPubHex — sender's ephemeral public key
 * @param {string} nonceHex
 * @param {Uint8Array} recipientPrivKey — recipient's messaging private key
 * @returns {string|null} plaintext or null if decryption fails
 */
export async function decryptMessage(ciphertextHex, ephemeralPubHex, nonceHex, recipientPrivKey) {
  try {
    const ephPubBytes = hexToBytes(ephemeralPubHex);
    const sharedRaw = secp.getSharedSecret(recipientPrivKey, ephPubBytes, true);
    const aesKeyBuf = await crypto.subtle.digest("SHA-256", sharedRaw);
    const aesKey = await crypto.subtle.importKey("raw", aesKeyBuf, "AES-GCM", false, ["decrypt"]);

    const nonce = hexToBytes(nonceHex);
    const ciphertext = hexToBytes(ciphertextHex);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
