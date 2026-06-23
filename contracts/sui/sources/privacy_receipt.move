// SPDX-License-Identifier: MIT
module upl::privacy_receipt {
    /// Encrypted-delivery receipt for a private transfer.
    ///
    /// Maps the EVM `EncryptedReceipts` contract (which emits an
    /// `EncryptedReceipt` event per private send carrying an ECDH-derived
    /// ciphertext the recipient decrypts off-chain) onto Sui's owned-object
    /// model. Where the EVM contract kept receipts as ethemeral event data
    /// (queryable off-chain via the receipt's `txHash`/`logIndex` but NOT a
    /// state object you could own or transfer), this module makes each
    /// receipt a **first-class owned object** (`PrivacyReceipt`, `key+store`)
    /// minted by the relayer at relay-time and `transfer`'d to the recipient.
    ///
    /// Why owned object instead of pure event:
    ///   - The recipient can hold/transfer/forward a verifiable receipt they
    ///     fully control (useful for refunds/double-spend-proofs, and as the
    ///     Sui-native analog of the "NFT receipt" Phase-4 goal).
    ///   - Indexers still trivially pick up the `ReceiptIssued` event for
    ///     their own query layer; the object is the *user-facing* half.
    ///
    /// The on-chain state stores the opaque encrypted payload only — the
    /// relayer derives the ECDH key off-chain; no plaintext or key material
    /// ever lands on-chain. The recipient's wallet decrypts locally using the
    /// stealth private key derived from the registry announcement.
    ///
    /// Semantic differences from the EVM original:
    ///   - Solidity event `EncryptedReceipt(uint256 indexed, address indexed,
    ///     bytes ciphertext, bytes nonce)` -> Sui event `ReceiptIssued` +
    ///     owned `PrivacyReceipt` object carrying the same fields by value.
    ///   - `bytes ciphertext`/`bytes nonce` -> `vector<u8>` (Move's natural
    ///     bytestring; no ABI-codec length-prefix).
    ///   - Only the UPL relayer can mint receipts. On EVM that was a
    ///     `RelayerCap` address check via `PrivacyRelayer`; here the Sui
    ///     equivalent is a `ReceiptCap` (minted once in `init`, held by the
    ///     relayer operator) — the capability pattern, strictly safer than
    ///     `require(msg.sender == relayer)`.

    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::vector;

    /// Capability held by the relayer operator. The only bearer who may call
    /// `issue`. Created once in `init`, transferred to the publisher.
    /// `key+store` so it can be moved to a multisig, the same pattern as
    /// `privacy_relayer::RelayerCap`.
    public struct ReceiptCap has key, store { id: UID }

    /// Encrypted receipt object, owned by the recipient. Carries only opaque
    /// ciphertext + an encryption non`ce` + the originating (relay) tx id. The
    /// recipient decrypts off-chain; on-chain never sees plaintext.
    public struct PrivacyReceipt has key, store {
        id: UID,
        /// Recipient address from the originating `privacy_relayer::relay`.
        /// Stored so a wallet UI can show "receipt for you" without needing to
        /// decrypt first; the recipient already knows their own address.
        recipient: address,
        /// Opaque ciphertext (ECDH-derived symmetric-key encryption of the
        /// transfer detail blob: amount, view tag, ephemeral key, memo). All
        /// length-validated off-chain; we store the raw bytes.
        ciphertext: vector<u8>,
        /// Encryption nonce / IV. Public but unique-per-encryption — never
        /// reused with the same key, which is the symmetric-cipher contract.
        nonce: vector<u8>,
        /// A commitment back to the originating registry announcement id
        /// (when applicable), so indexers can correlate a receipt to its
        /// stealth-address announcement. `0` if the receipt is for a flow
        /// outside the announcement registry (e.g. a refund).
        announcement_id: u64,
        /// `Clock::timestamp_ms` at issue. The EVM contract used
        /// `block.timestamp` (seconds); ms here, divide by 1000 for seconds.
        timestamp_ms: u64,
    }

    /// Event emitted on every receipt mint. Mirrors the EVM `EncryptedReceipt`.
    public struct ReceiptIssued has copy, drop {
        receipt: address,
        recipient: address,
        announcement_id: u64,
        timestamp_ms: u64,
        /// Sizes only — keeps the event cheap to index (no giant ciphertext in
        /// the event log; the object itself holds the bytes).
        ciphertext_len: u64,
        nonce_len: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    const EEmptyCiphertext: u64 = 1;
    const EEmptyNonce: u64 = 2;
    const EZeroRecipient: u64 = 3;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints one `ReceiptCap` and transfers it to the publisher, who will
    /// move it to the configured relayer (mirroring `privacy_relayer::init`).
    fun init(ctx: &mut TxContext) {
        let cap = ReceiptCap { id: object::new(ctx) };
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // ─── Relayer entry — the only writer ───────────────────────────────────
    /// Mint an encrypted receipt for `recipient` and `transfer` it to them.
    /// `cap` is the relayer capability (the compile-time capability gate).
    public(package) entry fun issue(
        _cap: &ReceiptCap,
        recipient: address,
        ciphertext: vector<u8>,
        nonce: vector<u8>,
        announcement_id: u64,
        timestamp_ms: u64,
        ctx: &mut TxContext,
    ) {
        assert!(recipient != @0x0, EZeroRecipient);
        assert!(!vector::is_empty(&ciphertext), EEmptyCiphertext);
        assert!(!vector::is_empty(&nonce), EEmptyNonce);

        let receipt = PrivacyReceipt {
            id: object::new(ctx),
            recipient,
            ciphertext,
            nonce,
            announcement_id,
            timestamp_ms,
        };
        let receipt_addr = object::uid_to_address(&receipt.id);
        event::emit(ReceiptIssued {
            receipt: receipt_addr,
            recipient,
            announcement_id,
            timestamp_ms,
            ciphertext_len: vector::length(&receipt.ciphertext),
            nonce_len: vector::length(&receipt.nonce),
        });
        transfer::public_transfer(receipt, recipient);
    }

    // ─── Public reads (indexers + recipient wallets) ───────────────────────
    public fun recipient(r: &PrivacyReceipt): address { r.recipient }
    public fun ciphertext(r: &PrivacyReceipt): &vector<u8> { &r.ciphertext }
    public fun nonce(r: &PrivacyReceipt): &vector<u8> { &r.nonce }
    public fun announcement_id(r: &PrivacyReceipt): u64 { r.announcement_id }
    public fun timestamp_ms(r: &PrivacyReceipt): u64 { r.timestamp_ms }

    // ─── Recipient entry — discard once decrypted & no longer needed ───────
    /// Destroy a `PrivacyReceipt` the recipient has finished with. Caller must
    /// own the object (Sui object model enforces). Useful to declutter a
    /// wallet once the transfer is reconciled / spent; the EVM contract had
    /// no equivalent (events are permanent), but on Sui permanent-storage-by-
    /// default would make the recipient's account grow unboundedly.
    entry fun discard(receipt: PrivacyReceipt) {
        let PrivacyReceipt {
            id,
            recipient: _,
            ciphertext: _,
            nonce: _,
            announcement_id: _,
            timestamp_ms: _,
        } = receipt;
        object::delete(id);
    }

    // ─── Test helpers ────────────────────────────────────────────────────────
    /// Mint a test `ReceiptCap` (the production `init` transfers one to the
    /// publisher, but tests create their own to drive `issue`).
    #[test_only]
    public fun new_test_receipt_cap(ctx: &mut TxContext): ReceiptCap {
        ReceiptCap { id: object::new(ctx) }
    }

    /// Destroy a test `ReceiptCap`.
    #[test_only]
    public fun destroy_test_receipt_cap(cap: ReceiptCap) {
        let ReceiptCap { id } = cap;
        object::delete(id);
    }

    /// Destroy a test `PrivacyReceipt` without going through the private
    /// `discard` entry (which test modules — separate modules — cannot call).
    /// Same destructuring as `discard`.
    #[test_only]
    public fun destroy_test_receipt(receipt: PrivacyReceipt) {
        let PrivacyReceipt {
            id,
            recipient: _,
            ciphertext: _,
            nonce: _,
            announcement_id: _,
            timestamp_ms: _,
        } = receipt;
        object::delete(id);
    }
}