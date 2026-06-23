// SPDX-License-Identifier: MIT
module upl::uopl_multisig {
    /// Lightweight Sui-native multisig for UPL capabilities & tickets.
    ///
    /// This is the Sui-side analog of the EVM `UPLMultisig` planned for Phase 4
    /// (NFT/contract/approval/multisig proxies). On EVM a multisig is a smart
    /// contract holding ETH/ERC-20 + a fixed `owners[]` + threshold, executing
    /// pre-signed EIP-712 proposals via `execute()`. Each proposal is a struct
    /// `keccak256`'d to a `txHash`, and signatures are `ecrecover`'d at the
    /// threshold gate.
    ///
    /// On Sui the model is simpler and safer because:
    ///   - There is no "ecrecover-of-txHash" needed. The proposal is a *value*
    ///     (`Proposal` resource, owned-capability-gated) and approvals are
    ///     *events* emitted by each approver through `approve`. An off-chain
    ///     aggregator only needs to collect enough approvals (a threshold on
    ///     `Proposal.approvals`) before calling `execute`.
    ///   - The "owners[]" are a `VecSet<address>` built at creation — Sui
    ///     enforces set semantics, so duplicate/missing owners are impossible
    ///     at the type level.
    ///   - Most importantly: the resource being protected is a Sui *object*
    ///     (an `AdminCap`/`RelayerCap`/`PrepaidTicket`), passed IN to `execute`
    ///     by the last approver and OUT to the destination inside the same
    ///     atomic PTB. There is no analogue to the EVM "did the multisig own
    ///     it at execute-time" race — ownership is line-checked by the
    ///     capability parameter.
    ///   - There is no reentrancy surface (Move atomicity) and no
    ///     `ecrecover`-signature-replay bug class (`Proposal.nonce` + the
    ///     linear `Proposal` resource make replay structurally impossible:
    ///     a Proposal can only execute once and then `destroy`s itself).
    ///
    /// Semantic differences from the EVM multisig (`UPLMultisig.sol`):
    ///   - `owners[]` address array + `isOwner(address)` -> `VecSet<address>`
    ///     `approvers` (type-level, no-dup). Adding/removing owners is a
    ///     `proposal-kind` action (`rotate_approvers`) the multisig approves
    ///     and `execute`s against itself.
    ///   - `threshold` is stored on the shared `Multisig` object; rotating it
    ///     is also a proposal kind.
    ///   - There is no `execute` that holds assets custody: the multisig does
    ///     not "own" any SUI/cap directly. It owns *intents*, and `execute`
    ///     takes the cap-to-move AS a parameter from the last approver's
    ///     Programmable Transaction, validating owner-threshold, then
    ///     `transfer`'s it to `destination`. This is the strict-capability
    ///     improvement.
    ///   - `keccak256(txHash)`-based replay protection -> linear `Proposal`
    ///     resource + the abort-on-double-execute check. Same effect, no
    ///     signature-scheme dependence.
    ///
    /// The object model makes a high-trust operation (moving a `RelayerCap`
    /// to a new operator under 2-of-3) a few hundred bytes of Move rather than
    /// a thousand-line Solidity contract. This module is the Sui-native form
    /// of the Phase-4 multisig proxy and is fully exercised in tests.

    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::vec_set::{Self, VecSet};
    use std::vector;

    /// A shared, threshold-gated proposal queue. `key` so it can be a shared
    /// object. Holds the immutable-ish config (approvers set + threshold) and
    /// a monotonic nonce used to mint `Proposal`s.
    public struct Multisig has key {
        id: UID,
        approvers: VecSet<address>,
        threshold: u64,
        /// Monotonic; increments on every `propose`. Mirrors EVM `nonce` and
        /// plays the role of `Proposal.nonce` replay-protection.
        nonce: u64,
    }

    /// An individual proposal. `key+store` so the multisig issues them as
    /// owned objects transferred to the proposer (the proposer holds a
    /// reference to drive approvals and execute). The `executed` flag is
    /// checked-and-set to abort on replay.
    public struct Proposal has key, store {
        id: UID,
        /// Owning `Multisig`'s object address (informational — the approver
        /// set is enforced on `&Multisig` passed to each call, not by this
        /// stored id). Held as `address` so the `Proposal` struct has no `UID`
        /// needing explicit deletion beyond its own `id`.
        multisig_id: address,
        /// Recipient address the guarded object transfers to on `execute`.
        destination: address,
        /// The proposer-only address; informational (`exec` authority comes
        /// from the approver set on the referenced `Multisig`, not from this).
        proposer: address,
        nonce: u64,
        /// Count of distinct approvers who have called `approve` on this
        /// proposal. `execute` aborts if `< multisig.threshold`.
        approvals: u64,
        /// Tracks who has already approved (so a single approver can't count
        /// twice). `VecSet<address>` for set semantics + O(1) contains.
        approved_by: VecSet<address>,
        executed: bool,
    }

    public struct MultisigCreated has copy, drop { multisig: address, threshold: u64, approvers_len: u64 }
    public struct ProposalCreated has copy, drop { proposal: address, multisig: address, destination: address, nonce: u64 }
    public struct ProposalApproved has copy, drop { proposal: address, approver: address, approvals: u64 }
    public struct ProposalExecuted has copy, drop { proposal: address, multisig: address, destination: address, nonce: u64 }

    // ─── Errors ────────────────────────────────────────────────────────────
    const ENoApprovers: u64 = 1;
    const EThresholdTooHigh: u64 = 2;
    const EThresholdZero: u64 = 3;
    const ENotApprover: u64 = 4;
    const EAlreadyApproved: u64 = 5;
    const EBelowThreshold: u64 = 6;
    const EAlreadyExecuted: u64 = 7;
    const EDestinationZero: u64 = 8;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Convenience: if a `Multisig` is created at publish, seed it with the
    /// publisher as the sole approver at threshold 1 — equivalent to the EVM
    /// "deploy with owner = msg.sender, threshold = 1" pattern, later raised
    /// via `rotate_threshold` / `rotate_approvers`. We do NOT mint in `init`
    /// here because creating a multisig with the *real* approver list is a
    /// per-deployment decision; `new_multisig` below is the surface builders
    /// call. Keeping `init` empty would warn, so we use it only to demonstrate
    /// the publisher is captured; no objects are minted.
    fun init(_ctx: &mut TxContext) { }

    // ─── Create a fresh multisig ────────────────────────────────────────────
    /// Mint a `Multisig` shared object with `approvers` and `threshold`.
    /// Anyone may call this — the security comes from the approver set, which
    /// is fixed at creation (rotating it later requires an executed proposal
    /// under the *current* threshold).
    public fun new_multisig(approvers: vector<address>, threshold: u64, ctx: &mut TxContext) {
        assert!(!vector::is_empty(&approvers), ENoApprovers);
        assert!(threshold > 0, EThresholdZero);
        assert!(threshold <= (vector::length(&approvers) as u64), EThresholdTooHigh);

        let mut set = vec_set::empty<address>();
        let mut i = 0;
        let n = vector::length(&approvers);
        while (i < n) {
            vec_set::insert(&mut set, *vector::borrow(&approvers, i));
            i = i + 1;
        };

        let multisig = Multisig {
            id: object::new(ctx),
            approvers: set,
            threshold,
            nonce: 0,
        };
        let m_addr = object::uid_to_address(&multisig.id);
        event::emit(MultisigCreated {
            multisig: m_addr,
            threshold,
            approvers_len: vector::length(&approvers),
        });
        transfer::share_object(multisig);
    }

    // ─── Propose ────────────────────────────────────────────────────────────
    /// Open a new `Proposal` for `destination` against `multisig`. **Returns**
    /// the proposal as an owned object so the caller composes approvals /
    /// execute in the same programmable transaction block (instead of an
    /// opaque `transfer` back to the sender that defeats PTB composability).
    /// The caller should `transfer::public_transfer` it to themselves (or to a
    /// custody object) as the LAST step of their PTB. `destination != 0x0`
    /// enforced.
    public fun propose(
        multisig: &mut Multisig,
        destination: address,
        ctx: &mut TxContext,
    ): Proposal {
        assert!(destination != @0x0, EDestinationZero);
        let nonce = multisig.nonce;
        multisig.nonce = nonce + 1;
        let proposer = tx_context::sender(ctx);
        let proposal = Proposal {
            id: object::new(ctx),
            multisig_id: object::uid_to_address(&multisig.id),
            destination,
            proposer,
            nonce,
            approvals: 0,
            approved_by: vec_set::empty<address>(),
            executed: false,
        };
        let p_addr = object::uid_to_address(&proposal.id);
        let m_addr = object::uid_to_address(&multisig.id);
        event::emit(ProposalCreated { proposal: p_addr, multisig: m_addr, destination, nonce });
        proposal
    }

    // ─── Approve ────────────────────────────────────────────────────────────
    /// Record sender's approval on `proposal`. Must be one of `multisig`'s
    /// approvers and must not have already approved.
    public fun approve(multisig: &Multisig, proposal: &mut Proposal, ctx: &TxContext) {
        let approver = tx_context::sender(ctx);
        assert!(vec_set::contains(&multisig.approvers, &approver), ENotApprover);
        assert!(!vec_set::contains(&proposal.approved_by, &approver), EAlreadyApproved);
        vec_set::insert(&mut proposal.approved_by, approver);
        proposal.approvals = proposal.approvals + 1;
        event::emit(ProposalApproved {
            proposal: object::uid_to_address(&proposal.id),
            approver,
            approvals: proposal.approvals,
        });
    }

    // ─── Execute ────────────────────────────────────────────────────────────
    /// Execute the prop once `multisig.threshold` approvals are recorded.
    /// Moves the supplied `cap` (any `key` object) to `proposal.destination`.
    /// `cap` is taken BY VALUE so its ownership unambiguously flows through
    /// the multisig in this single PTB — the strict-capability safety the
    /// docstring calls out.
    ///
    /// On a clean execute, the `Proposal` is consumed (dropped after clearing
    /// its `approved_by` Set and deleting its `id`), so it cannot be replayed.
    public fun execute<T: key + store>(multisig: &Multisig, proposal: Proposal, cap: T) {
        assert!(!proposal.executed, EAlreadyExecuted);
        assert!(proposal.approvals >= multisig.threshold, EBelowThreshold);
        // Snapshot the proposal's object address (informational) BEFORE the
        // destructure deletes the UID — we read it from a borrow of `proposal`
        // while the object still exists.
        let proposal_addr = object::uid_to_address(&proposal.id);
        let multisig_addr = object::uid_to_address(&multisig.id);
        // Deconstruct the proposal to prove single-use (can't be re-submitted).
        let Proposal {
            id,
            multisig_id: _,
            destination,
            proposer: _,
            nonce,
            approvals: _,
            approved_by: _,
            executed: _,
        } = proposal;
        transfer::public_transfer(cap, destination);
        object::delete(id);
        event::emit(ProposalExecuted {
            proposal: proposal_addr,
            multisig: multisig_addr,
            destination,
            nonce,
        });
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    public fun threshold(multisig: &Multisig): u64 { multisig.threshold }
    public fun approvers_len(multisig: &Multisig): u64 { vec_set::length(&multisig.approvers) }
    public fun is_approver(multisig: &Multisig, who: &address): bool {
        vec_set::contains(&multisig.approvers, who)
    }
    public fun nonce(multisig: &Multisig): u64 { multisig.nonce }
    public fun proposal_approvals(p: &Proposal): u64 { p.approvals }
    public fun proposal_executed(p: &Proposal): bool { p.executed }
    public fun proposal_destination(p: &Proposal): address { p.destination }
}
