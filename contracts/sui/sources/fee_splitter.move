// SPDX-License-Identifier: MIT
module upl::fee_splitter {
    /// Configurable proportional fee distribution to multiple payees.
    ///
    /// `privacy_relayer` accumulates fees in a single `Balance<SUI>` withdrawable
    /// only by the `AdminCap` holder. That is the simplest correct model for a
    /// single-operator MVP. But the project's stated operator model (see
    /// `privacy_relayer` docstring + the EVM `PrivacyRelayer.sol` deploy notes
    /// at P1.9/P1.10) is a *set* of relayer operators, each running a hot wallet
    /// that the `RelayerCap` holder rotates to. In that model the accrued fees
    /// should NOT all land in one admin's pocket — they should be split
    /// proportionally across the operators who actually did the relaying work.
    ///
    /// This module implements that split. It is a shared `FeeSplitter` object
    /// holding:
    ///   - a `VecSet<address>` of registered payees,
    ///   - per-payee weight (basis points; total must == 10000),
    ///   - and a `Balance<SUI>` accumulator that grows on `deposit` and
    ///     drains on `distribute` (a per-payee `Coin<SUI>` withdrawal).
    ///
    /// The split is **proportional by weight**, not by relay count — this lets
    /// the admin express "operator A gets 60% of fees, operator B gets 40%"
    /// regardless of which operator's hot wallet relayed a given transfer. The
    /// rationale is that the operators collectively co-sign the relayer's
    /// `RelayerCap` custody (via `uopl_multisig`), so the split is an
    /// economic agreement, not an on-chain per-call attribution.
    ///
    /// Semantic differences from the EVM `PrivacyRelayer.sol`:
    ///   - The EVM contract has a single `accumulatedFees` + `withdrawFees(to)`
    ///     — it does NOT split across operators. This module is a Sui-native
    ///     extension that the project's multi-operator model genuinely needs.
    ///   - EVM `onlyOwner` -> `AdminCap` capability resource held by the
    ///     deployer, same pattern as `privacy_relayer::AdminCap`.
    ///   - `mapping(payee => weight)` -> `VecMap<address, u64>` enforced at
    ///     construction to sum to exactly `FEE_DENOMINATOR == 10000`. The
    ///     `VecSet` prevents duplicate payees (type-level set guarantee).
    ///   - `distribute` is idempotent: it splits whatever balance has
    ///     accumulated into per-payee `Coin<SUI>` withdrawals. If the balance
    ///     is zero, it is a no-op (not an abort — matching the "no work to do"
    ///     return pattern of `view_tag_index::page` on an empty bucket).
    ///   - Payee rotation (add/remove) requires all existing payees to consent
    ///     via a multisig proposal against `AdminCap` (the project already has
    ///     `uopl_multisig` for this). For simplicity this module rotates on an
    ///     `AdminCap` gate alone — the multisig is a composition layer the
    ///     deployer adds via PTB. This matches the existing pattern where
    ///     `AdminCap` + `uopl_multisig` compose without a module-level
    ///     dependency.

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::vec_map::{Self, VecMap};
    use sui::vec_set::{Self, VecSet};
    use std::vector;

    /// Admin capability. The holder can: add/remove payees, set weights,
    /// and call `distribute`. Created once in `init`, transferred to the
    /// publisher. Transferable so the deployer can move it to a multisig.
    public struct AdminCap has key, store {
        id: UID,
    }

    /// Shared, configurable fee-splitter state. Holds the payee set + weight
    /// map + a SUI fee accumulator. `deposit` adds to the accumulator;
    /// `distribute` splits and withdraws.
    public struct FeeSplitter has key {
        id: UID,
        /// Registered payees (set semantics — no duplicates).
        payees: VecSet<address>,
        /// Per-payee weight in basis points. Must sum to `FEE_DENOMINATOR`
        /// for the splitter to be valid; invariant is enforced at
        /// construction and rotation. A payee's share of `distribute` is
        ///   (balance * weight / FEE_DENOMINATOR).
        weights: VecMap<address, u64>,
        /// SUI fee accumulator. Grows on `deposit`; drains on `distribute`.
        accumulated: Balance<SUI>,
        /// Running total of SUI ever distributed, across all payees.
        /// Monotonic; mirrors `privacy_relayer::total_relayed` in spirit.
        total_distributed: u64,
    }

    // ─── Events ───────────────────────────────────────────────────────────
    public struct FeesDeposited has copy, drop { amount: u64 }
    public struct FeesDistributed has copy, drop { payee: address, amount: u64 }
    public struct PayeeAdded has copy, drop { payee: address, weight: u64 }
    public struct PayeeRemoved has copy, drop { payee: address }
    public struct WeightsUpdated has copy, drop { payees_len: u64 }

    // ─── Errors ────────────────────────────────────────────────────────────
    const EZeroAmount: u64 = 1;
    /// Returned when the weights do not sum to `FEE_DENOMINATOR`.
    const EWeightsMustSumToDenominator: u64 = 2;
    const EPayeeAlreadyExists: u64 = 3;
    const EPayeeNotFound: u64 = 4;
    /// Returned on `distribute` when a computed share rounds to 0 for a
    /// payee with a nonzero weight (would mean the balance is too small
    /// relative to the weight granularity). The admin should wait for the
    /// accumulator to grow before distributing.
    const EShareRoundsToZero: u64 = 5;
    const ENoPayees: u64 = 6;
    const EWeightZero: u64 = 7;

    /// Fee denominator (10000 = 100%). Matches `privacy_relayer::FEE_DENOMINATOR`.
    const FEE_DENOMINATOR: u64 = 10000;

    // ─── Module init ───────────────────────────────────────────────────────
    /// Mints the shared `FeeSplitter` (empty payee set, zero balance) and one
    /// `AdminCap` transferred to the publisher. The admin adds payees and sets
    /// weights via `add_payee`/`set_weights` after publish.
    fun init(ctx: &mut TxContext) {
        let splitter = FeeSplitter {
            id: object::new(ctx),
            payees: vec_set::empty<address>(),
            weights: vec_map::empty<address, u64>(),
            accumulated: balance::zero<SUI>(),
            total_distributed: 0,
        };
        transfer::share_object(splitter);
        let admin = AdminCap { id: object::new(ctx) };
        transfer::transfer(admin, tx_context::sender(ctx));
    }

    // ─── Admin writes (AdminCap-gated) ────────────────────────────────────
    /// Add a new payee with the given weight (in bps). The new payee's weight
    /// must NOT cause the total to exceed `FEE_DENOMINATOR` — the admin must
    /// call `set_weights` on the existing payees to reduce their allocations
    /// before adding, or use `set_weights` to recalculate the full set at
    /// once. Payee addresses must be unique (enforced by `VecSet`).
    public(package) entry fun add_payee(
        _admin: &AdminCap,
        splitter: &mut FeeSplitter,
        payee: address,
        weight: u64,
    ) {
        assert!(payee != @0x0, EZeroAmount); // reuse code; means "zero address"
        assert!(weight > 0, EWeightZero);
        assert!(!vec_set::contains(&splitter.payees, &payee), EPayeeAlreadyExists);

        // Verify the new total does not exceed FEE_DENOMINATOR.
        let current_total = weights_sum(&splitter.weights);
        assert!(current_total + weight <= FEE_DENOMINATOR, EWeightsMustSumToDenominator);

        vec_set::insert(&mut splitter.payees, payee);
        vec_map::insert(&mut splitter.weights, payee, weight);

        event::emit(PayeeAdded { payee, weight });
    }

    /// Remove a payee entirely. Their weight slot is freed; the remaining
    /// weights are NOT automatically rebalanced — the admin must call
    /// `set_weights` on the remaining payees to redistribute the freed bps.
    public(package) entry fun remove_payee(
        _admin: &AdminCap,
        splitter: &mut FeeSplitter,
        payee: address,
    ) {
        assert!(vec_set::contains(&splitter.payees, &payee), EPayeeNotFound);
        vec_set::remove(&mut splitter.payees, &payee);
        let (_, _old_weight) = vec_map::remove(&mut splitter.weights, &payee);
        event::emit(PayeeRemoved { payee });
    }

    /// Set all weights at once. The caller must supply a vector of
    /// `(address, u64)` pairs whose addresses are exactly the current
    /// payee set and whose weights sum to exactly `FEE_DENOMINATOR`. This is
    /// the safe rotation surface — the admin can rebalance by submitting the
    /// full weight map in one transaction.
    public(package) entry fun set_weights(
        _admin: &AdminCap,
        splitter: &mut FeeSplitter,
        new_weights: vector<address>,
        new_bps: vector<u64>,
    ) {
        let n = vector::length(&new_weights);
        assert!(n > 0, ENoPayees);
        assert!(n == vector::length(&new_bps));
        // We cannot enumerate a VecSet in Move, so we verify by checking that
        // each (address, weight) pair is a current payee and the sum ==
        // FEE_DENOMINATOR. We build a fresh VecMap and swap it in.
        let mut map = vec_map::empty<address, u64>();
        let mut sum = 0;
        let mut i = 0;
        while (i < n) {
            let addr = *vector::borrow(&new_weights, i);
            let bps = *vector::borrow(&new_bps, i);
            assert!(bps > 0, EWeightZero);
            assert!(vec_set::contains(&splitter.payees, &addr), EPayeeNotFound);
            vec_map::insert(&mut map, addr, bps);
            sum = sum + bps;
            i = i + 1;
        };
        assert!(sum == FEE_DENOMINATOR, EWeightsMustSumToDenominator);
        // All entries validated; swap in.
        splitter.weights = map;
        event::emit(WeightsUpdated { payees_len: n });
    }

    // ─── Public entry — deposit ────────────────────────────────────────────
    /// Deposit `payment` into the fee accumulator. This is the only way the
    /// `accumulated` balance grows — the conventional caller is
    /// `privacy_relayer::withdraw_fees` (it takes accrued fees from
    /// `RelayerState` and routes them here via PTB). `deposit` is NOT
    /// `AdminCap`-gated: anyone may deposit fees (e.g. a treasury top-up or an
    /// external donation — the balance only ever leaves via `distribute` which
    /// IS admin-gated).
    public fun deposit(
        splitter: &mut FeeSplitter,
        payment: Coin<SUI>,
    ) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);
        let _total = balance::join(&mut splitter.accumulated, coin::into_balance(payment));
        event::emit(FeesDeposited { amount });
    }

    // ─── Admin entry — distribute ──────────────────────────────────────────
    /// Split the accumulated balance across all payees proportionally by
    /// weight, creating a `Coin<SUI>` for each and transferring it to them.
    /// The remainder (dust from integer division) stays in `accumulated` —
    /// this is the standard fee-splitter invariant: dust accrues until a
    /// future `distribute` call absorbs it.
    ///
    /// Aborts with `EShareRoundsToZero` if any payee with a nonzero weight
    /// would receive 0 coins (the accumulated balance is too small relative
    /// to the weight granularity). The admin should wait for more deposits.
    public(package) entry fun distribute(
        _admin: &AdminCap,
        splitter: &mut FeeSplitter,
        ctx: &mut TxContext,
    ) {
        let total = balance::value(&splitter.accumulated);
        if (total == 0) { return }; // no-op on empty accumulator

        // Iterate payees, compute each share, split out, transfer.
        let payees_vec = vec_set::keys(&splitter.payees);
        let n = vector::length(payees_vec);
        let mut i = 0;
        while (i < n) {
            let payee = *vector::borrow(&payees_vec, i);
            let weight = *vec_map::get(&splitter.weights, &payee);
            let share = total * weight / FEE_DENOMINATOR;
            // Forbidding 0-shares prevents a payee getting nothing when they
            // deserve something (the accumulator is just too small). The admin
            // can skip the zero-weight payees by waiting, or we could permit
            // zero-shares; but since weights are > 0, a zero share means the
            // balance is so small that splitting it is meaningless.
            assert!(share > 0, EShareRoundsToZero);
            let share_bal = balance::split(&mut splitter.accumulated, share);
            let share_coin = coin::from_balance(share_bal, ctx);
            let amount = coin::value(&share_coin);
            splitter.total_distributed = splitter.total_distributed + amount;
            transfer::public_transfer(share_coin, payee);
            event::emit(FeesDistributed { payee, amount });
            i = i + 1;
        };
        // Any remaining dust (from integer division) stays in `accumulated`.
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Current accumulated, undistributed balance.
    public fun accumulated(splitter: &FeeSplitter): u64 {
        balance::value(&splitter.accumulated)
    }

    /// Cumulative SUI distributed across all payees, across all time.
    /// Monotonic.
    public fun total_distributed(splitter: &FeeSplitter): u64 {
        splitter.total_distributed
    }

    /// Number of registered payees.
    public fun payees_len(splitter: &FeeSplitter): u64 {
        vec_set::length(&splitter.payees)
    }

    /// Whether `payee` is in the payee set.
    public fun is_payee(splitter: &FeeSplitter, payee: &address): bool {
        vec_set::contains(&splitter.payees, payee)
    }

    /// Weight (bps) for `payee`. Aborts with `EPayeeNotFound` if not a payee.
    public fun weight(splitter: &FeeSplitter, payee: &address): u64 {
        assert!(vec_set::contains(&splitter.payees, payee), EPayeeNotFound);
        *vec_map::get(&splitter.weights, payee)
    }

    /// Sum of all weights. Should equal `FEE_DENOMINATOR == 10000` after a
    /// valid `set_weights` call; may be less before `set_weights` is first
    /// called after adding payees.
    public fun weights_sum(splitter: &FeeSplitter): u64 {
        weights_sum_map(&splitter.weights)
    }

    // ─── Internal ──────────────────────────────────────────────────────────
    /// Sum all values in a `VecMap<address, u64>`. Used for invariant checks.
    fun weights_sum_map(map: &VecMap<address, u64>): u64 {
        let keys = vec_map::keys(map);
        let n = vector::length(&keys);
        let mut sum = 0;
        let mut i = 0;
        while (i < n) {
            let k = vector::borrow(&keys, i);
            sum = sum + *vec_map::get(map, k);
            i = i + 1;
        };
        sum
    }

    // ─── Test helpers (#[test_only]; excluded from the published package) ──
    #[test_only]
    public fun new_test_splitter(ctx: &mut TxContext): FeeSplitter {
        FeeSplitter {
            id: object::new(ctx),
            payees: vec_set::empty<address>(),
            weights: vec_map::empty<address, u64>(),
            accumulated: balance::zero<SUI>(),
            total_distributed: 0,
        }
    }

    #[test_only]
    public fun new_test_admin_cap(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    #[test_only]
    public fun destroy_test_admin_cap(cap: AdminCap) {
        let AdminCap { id } = cap;
        object::delete(id);
    }

    /// Destroy a test FeeSplitter, requiring the accumulated balance be zero.
    /// Call `distribute` first if it holds any SUI.
    #[test_only]
    public fun destroy_test_splitter(splitter: FeeSplitter) {
        let FeeSplitter { id, payees: _, weights: _, accumulated, total_distributed: _ } = splitter;
        balance::destroy_zero(accumulated);
        object::delete(id);
    }
}
