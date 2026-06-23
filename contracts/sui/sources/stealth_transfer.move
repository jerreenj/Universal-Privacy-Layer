// SPDX-License-Identifier: MIT
module upl::stealth_transfer {
    /// Full-flow coordinator tying the registry, relayer, receipt, view-tag
    /// index, and announcement indexer together.
    ///
    /// On EVM, the "private send" flow is split across three contracts
    /// (`StealthAddressRegistry.announce`, `PrivacyRelayer.relay` with an EIP-712
    /// signed intent, and `EncryptedReceipts.emit`) and an off-chain relayer
    /// stitches them together. There is no single contract that *composes*
    /// them — Solidity can't cross-call a third contract mid-tx the way the
    /// relayer orchestrates them off-chain without an extra `msg.value`-hopping
    /// layer.
    ///
    /// Sui's Programmable Transaction Block changes the picture: an owner can
    /// move `Coin<SUI>` + capabilities through a sequence of `upl::*` entries
    /// in ONE transaction, so the registry-announce → index → advance-cursor →
    /// relay → receipt-mint sequence is expressible *atomically on-chain* under
    /// `RelayerCap` here. This module is that composition surface — the canonical
    /// entry a relayer calls to perform a *complete* private send in a single PTB,
    /// so the recipient gets (a) a registry announcement, (b) the view-tag index
    /// entry, (c) the cursor advance, (d) the net funds, AND (e) an encrypted
    /// receipt, all-or-nothing.
    ///
    /// The module also offers `direct_send` for the self-relayed case: a sender
    /// who wants to skip paying a relayer entirely can run the same flow from
    /// their own wallet with no `RelayerCap` required, paying their own gas.
    /// This is the analog of an EVM user calling `StealthAddressRegistry.announce`
    /// then sending ETH directly to the stealth address — but on Sui the
    /// announcement + receipt are still minted for free inline, which the EVM
    /// flow required two separate contracts to do.
    ///
    /// Semantic differences from the EVM original:
    ///   - All primitives run in ONE Move PTB, atomically. EVM needed
    ///     off-chain relayer + 2 contracts + a mempool of EIP-712 intents.
    ///   - `RelayerCap` (capability) replaces `msg.sender == relayer` here for
    ///     the `relayed_send` path; `direct_send` is `RelayerCap`-less and uses
    ///     `tx_context::sender(ctx)` for the announcer/stealth-anchor.
    ///   - No implicit `msg.value` — the `Coin<SUI>` is folded through by
    ///     resource move; the net forwards to `recipient`, the fee (if any) is
    ///     already stripped by `privacy_relayer::relay` internally.
    ///   - The view-tag index and announcement indexer are updated in the same
    ///     PTB, so the on-chain scan surfaces are consistent with the registry
    ///     after every private send. The EVM has no analog — its `scanRange`
    ///     always reads the full array so no secondary index is needed.

    use sui::coin::{Self, Coin};
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use upl::privacy_relayer::{Self, RelayerCap, RelayerState};
    use upl::privacy_receipt::{Self, ReceiptCap};
    use upl::stealth_address_registry::{Self, Registry};
    use upl::view_tag_index::{Self, ViewTagIndex};
    use upl::announcement_indexer::{Self, AnnouncementIndexer};
    use std::vector;

    /// Event emitted on a fully-successful private send (one per
    /// `relayed_send` or `direct_send`). Lets an indexer see the complete flow
    /// with a single event, rather than reassembling it from the announcement
    /// + transfer + receipt events.
    public struct PrivateSendCompleted has copy, drop {
        /// Whether the fee-paying relayer (`RelayerCap`) path was used (true) or
        /// the self-relayed `direct_send` path (false).
        relayed: bool,
        recipient: address,
        announcement_id: u64,
        net_amount: u64,
        fee: u64,
        timestamp_ms: u64,
    }

    // ─── Errors ────────────────────────────────────────────────────────────
    const EZeroAmount: u64 = 1;
    const EZeroRecipient: u64 = 2;

    // ─── Relayed path (relayer holds RelayerCap + ReceiptCap) ──────────────
    /// Compose announce -> index -> advance-cursor -> relay -> issue-receipt
    /// atomically under a single PTB. The relayer pays nothing here beyond its
    /// own gas; the user-supplied `Coin<SUI>` covers the amount+fee (the fee is
    /// skimmed inside `privacy_relayer::relay`).
    ///
    /// `payment` is the *gross* coin; `relay` will strip the configured fee
    /// and forward the net to `recipient`. We separately announce into
    /// `registry`, index the view tag in `vti`, advance the indexer cursor,
    /// and mint the encrypted receipt via `receipt_cap`. All side-effects are
    /// ordered registry -> index -> cursor -> relay -> receipt so a partial
    /// failure aborts the whole transaction (Move atomicity), unlike the EVM
    /// flow where a relayed `relay()` and an out-of-band `announce()` could
    /// race in the mempool.
    public fun relayed_send(
        _relayer_cap: &RelayerCap,
        receipt_cap: &ReceiptCap,
        state: &mut RelayerState,
        registry: &mut Registry,
        vti: &mut ViewTagIndex,
        indexer: &mut AnnouncementIndexer,
        recipient: address,
        payment: Coin<SUI>,
        ephemeral_key: vector<u8>,
        view_tag: u8,
        stealth_hash: vector<u8>,
        ciphertext: vector<u8>,
        nonce: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(coin::value(&payment) > 0, EZeroAmount);
        assert!(recipient != @0x0, EZeroRecipient);

        // 1. Announce the stealth address. The registry mints an id we
        //    capture for the receipt's `announcement_id` anchor.
        let gross = coin::value(&payment);
        let before = stealth_address_registry::announcement_count(registry);
        // The registry's `announce` takes `view_tag: vector<u8>` (the canonical
        // 1-byte EIP-5564 tag wrapped in bytes); build that wrapper from the
        // `u8` tag we accept here for relay-compat.
        let view_tag_bytes = vector[view_tag];
        stealth_address_registry::announce(
            ctx,
            registry,
            ephemeral_key,
            view_tag_bytes,
            stealth_hash,
            clock,
        );
        let announcement_id = before;

        // 2. Index the view tag so scanners can enumerate announcements by tag.
        view_tag_index::record(vti, view_tag_bytes, announcement_id);

        // 3. Advance the announcement indexer cursor so paginated scans see
        //    the new announcement.
        announcement_indexer::advance_cursor(indexer, announcement_id);

        // 4. Relay the funds (skims fee, forwards net, emits PrivateTransfer).
        //    Snapshot `total_relayed` before/after to recover the per-call net.
        let relayed_before = privacy_relayer::total_relayed(state);
        privacy_relayer::relay(
            _relayer_cap,
            state,
            recipient,
            vector[],
            view_tag,
            payment,
            clock,
            ctx,
        );
        let net = privacy_relayer::total_relayed(state) - relayed_before;
        let fee = gross - net;

        // 5. Encrypted receipt to the recipient.
        privacy_receipt::issue(
            receipt_cap,
            recipient,
            ciphertext,
            nonce,
            announcement_id,
            clock::timestamp_ms(clock),
            ctx,
        );

        event::emit(PrivateSendCompleted {
            relayed: true,
            recipient,
            announcement_id,
            net_amount: net,
            fee,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    // ─── Self-relayed path (no RelayerCap — user runs their own PTB) ────────
    /// Announce + index + advance-cursor + forward a `Coin<SUI>` directly to
    /// `recipient` + mint the encrypted receipt, WITHOUT a relayer. The caller
    /// pays their own gas and the entire `payment` lands with `recipient`
    /// (no fee skim — this is the free, non-custodial path). Intended for
    /// users who refuse to trust any relayer with their intent and want a
    /// one-shot private send from their own wallet. The announcement is still
    /// indexable exactly as in the relayed path, so the recipient's scanner
    /// sees it identically.
    public fun direct_send(
        receipt_cap: &ReceiptCap,
        registry: &mut Registry,
        vti: &mut ViewTagIndex,
        indexer: &mut AnnouncementIndexer,
        recipient: address,
        payment: Coin<SUI>,
        ephemeral_key: vector<u8>,
        view_tag: vector<u8>,
        stealth_hash: vector<u8>,
        ciphertext: vector<u8>,
        nonce: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(coin::value(&payment) > 0, EZeroAmount);
        assert!(recipient != @0x0, EZeroRecipient);

        let gross = coin::value(&payment);
        let before = stealth_address_registry::announcement_count(registry);
        stealth_address_registry::announce(
            ctx,
            registry,
            ephemeral_key,
            view_tag,
            stealth_hash,
            clock,
        );
        let announcement_id = before;

        // Index the view tag and advance the indexer cursor.
        view_tag_index::record(vti, view_tag, announcement_id);
        announcement_indexer::advance_cursor(indexer, announcement_id);

        // No fee — the full gross forwards directly to the recipient.
        transfer::public_transfer(payment, recipient);

        privacy_receipt::issue(
            receipt_cap,
            recipient,
            ciphertext,
            nonce,
            announcement_id,
            clock::timestamp_ms(clock),
            ctx,
        );

        event::emit(PrivateSendCompleted {
            relayed: false,
            recipient,
            announcement_id,
            net_amount: gross,
            fee: 0,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }
}
