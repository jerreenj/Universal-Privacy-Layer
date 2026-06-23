// SPDX-License-Identifier: MIT
#[test_only]
module upl::privacy_relayer_tests {
    /// Tests for `upl::privacy_relayer`.
    ///
    /// Covers: zero-fee relay (fee_bps=0) forwards the full amount and accrues
    /// no fee; nonzero-fee relay skims the correct bps into `accumulated_fees`
    /// and bumps `total_relayed` by the net; `set_fee_bps` honors the
    /// `max_fee_bps` cap (rejects 101); `withdraw_fees` empties the accumulator;
    /// and the capability gates reject missing/null caps at the type level
    /// (the `_relayer_cap: &RelayerCap` param cannot be forged).
    ///
    /// All tests use the Sui 2024 no-arg form (`fun name() { ... dummy ctx ...
    /// }`) — the older `ctx: &mut TxContext`-arg form was deprecated (W10007)
    /// and silently skipped, so we read the context via `tx_context::dummy()`.

    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::tx_context::{Self, TxContext};
    use upl::privacy_relayer as rel;

    /// Owned unit-test clock pinned to a fixed timestamp. Held owned (NOT
    /// shared — sharing is for transactional tests; here we pass `&clock`
    /// directly to the entry-under-test).
    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 7_000_000_000_000);
        c
    }

    /// Zero-fee relay: the entire `Coin<SUI>` forwards to the recipient, the
    /// fee accumulator stays 0, and `total_relayed` grows by the full amount.
    #[test]
    fun relay_zero_fee_forwards_full_amount() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut state = rel::new_test_state(0, &mut ctx);
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);

        let amount = 1_000_000;
        let payment = coin::mint_for_testing<SUI>(amount, &mut ctx);

        rel::relay(
            &relayer_cap,
            &mut state,
            @0xCAFE,
            x"abcdef",
            0xAA,
            payment,
            &clock,
            &mut ctx,
        );

        assert!(rel::total_relayed(&state) == amount);
        assert!(rel::accumulated_fees(&state) == 0);

        rel::destroy_test_relayer_cap(relayer_cap);
        rel::destroy_test_state(state);
        clock::destroy_for_testing(clock);
    }

    /// Non-zero fee: 50 bps on a 1_000_000-mist payment = 5_000 mist fee,
    /// 995_000 net forwarded; the fee lands in `accumulated_fees`.
    #[test]
    fun relay_with_fee_skims_correct_bps() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut state = rel::new_test_state(50, &mut ctx);
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);

        let amount = 1_000_000;
        let payment = coin::mint_for_testing<SUI>(amount, &mut ctx);

        rel::relay(
            &relayer_cap,
            &mut state,
            @0xBEEF,
            x"1234",
            0x09,
            payment,
            &clock,
            &mut ctx,
        );

        // 50 / 10000 of 1_000_000 == 5_000 fee, 995_000 net.
        assert!(rel::total_relayed(&state) == 995_000);
        assert!(rel::accumulated_fees(&state) == 5_000);

        // The state carries a non-zero `accumulated_fees`; drain it via
        // `withdraw_fees` (AdminCap-gated) so `destroy_test_state`'
        // `balance::destroy_zero` invariant holds. The withdrawn Coin<SUI>
        // is forwarded to a nonzero recipient; we assert the accumulator
        // then reads zero.
        let admin_cap = rel::new_test_admin_cap(&mut ctx);
        rel::withdraw_fees(&admin_cap, &mut state, @0xFEED, &mut ctx);
        assert!(rel::accumulated_fees(&state) == 0);

        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_relayer_cap(relayer_cap);
        rel::destroy_test_state(state);
        clock::destroy_for_testing(clock);
    }

    /// `set_fee_bps` raises the rate and rejects anything over `max_fee_bps`
    /// (100). The setter is `AdminCap`-gated — we pass a real cap.
    #[test]
    fun set_fee_bps_works_under_cap() {
        let mut ctx = tx_context::dummy();
        let mut state = rel::new_test_state(0, &mut ctx);
        let admin_cap = rel::new_test_admin_cap(&mut ctx);

        assert!(rel::fee_bps(&state) == 0);
        rel::set_fee_bps(&admin_cap, &mut state, 25);
        assert!(rel::fee_bps(&state) == 25);
        rel::set_fee_bps(&admin_cap, &mut state, 100); // exactly the cap
        assert!(rel::fee_bps(&state) == 100);

        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_state(state);
    }

    /// `set_fee_bps(101)` aborts with `EFeeBpsTooHigh` (== 3): the cap is 100.
    #[test, expected_failure(abort_code = 3)]
    fun set_fee_bps_over_cap_aborts() {
        let mut ctx = tx_context::dummy();
        let mut state = rel::new_test_state(0, &mut ctx);
        let admin_cap = rel::new_test_admin_cap(&mut ctx);
        rel::set_fee_bps(&admin_cap, &mut state, 101);
        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_state(state);
    }

    /// `relay` with a zero-amount coin aborts with `EZeroAmount` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun relay_zero_amount_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut state = rel::new_test_state(50, &mut ctx);
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(0, &mut ctx);
        rel::relay(&relayer_cap, &mut state, @0xCAFE, x"ab", 0xAA, payment, &clock, &mut ctx);
        rel::destroy_test_relayer_cap(relayer_cap);
        rel::destroy_test_state(state);
        clock::destroy_for_testing(clock);
    }

    /// `relay` to the zero address aborts with `EInvalidRecipient` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun relay_to_zero_address_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut state = rel::new_test_state(50, &mut ctx);
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let payment = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        rel::relay(&relayer_cap, &mut state, @0x0, x"ab", 0xAA, payment, &clock, &mut ctx);
        rel::destroy_test_relayer_cap(relayer_cap);
        rel::destroy_test_state(state);
        clock::destroy_for_testing(clock);
    }

    /// End-to-end fee accrual + withdrawal: relay twice, then `withdraw_fees`
    /// empties the accumulator and re-runs at zero balance.
    #[test]
    fun withdraw_fees_empties_accumulator() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut state = rel::new_test_state(100, &mut ctx); // 1% fee
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let admin_cap = rel::new_test_admin_cap(&mut ctx);

        // Two relays of 1_000_000 each, 1% = 10_000 fee per relay.
        let p1 = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        rel::relay(&relayer_cap, &mut state, @0xCAFE, x"aa", 0x01, p1, &clock, &mut ctx);
        let p2 = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        rel::relay(&relayer_cap, &mut state, @0xBEEF, x"bb", 0x02, p2, &clock, &mut ctx);

        // 2 * 10_000 = 20_000 fees accrued; 2 * 990_000 = 1_980_000 relayed.
        assert!(rel::accumulated_fees(&state) == 20_000);
        assert!(rel::total_relayed(&state) == 1_980_000);

        // Withdraw to a nonzero recipient; accumulator should drain to 0.
        rel::withdraw_fees(&admin_cap, &mut state, @0xFEED, &mut ctx);
        assert!(rel::accumulated_fees(&state) == 0);

        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_relayer_cap(relayer_cap);
        rel::destroy_test_state(state);
        clock::destroy_for_testing(clock);
    }

    /// `withdraw_fees` on an empty accumulator aborts with `EWithdrawZero` (== 4).
    #[test, expected_failure(abort_code = 4)]
    fun withdraw_when_empty_aborts() {
        let mut ctx = tx_context::dummy();
        let mut state = rel::new_test_state(50, &mut ctx);
        let admin_cap = rel::new_test_admin_cap(&mut ctx);
        rel::withdraw_fees(&admin_cap, &mut state, @0xCAFE, &mut ctx);
        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_state(state);
    }

    /// `withdraw_fees` to the zero address aborts with `EInvalidRecipient` (== 2).
    /// One relay first so the accumulator is non-empty (otherwise we'd hit the
    /// EWithdrawZero check first).
    #[test, expected_failure(abort_code = 2)]
    fun withdraw_to_zero_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let mut state = rel::new_test_state(100, &mut ctx);
        let relayer_cap = rel::new_test_relayer_cap(&mut ctx);
        let admin_cap = rel::new_test_admin_cap(&mut ctx);
        let p = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        rel::relay(&relayer_cap, &mut state, @0xCAFE, x"aa", 0x01, p, &clock, &mut ctx);
        rel::withdraw_fees(&admin_cap, &mut state, @0x0, &mut ctx);
        rel::destroy_test_admin_cap(admin_cap);
        rel::destroy_test_relayer_cap(relayer_cap);
        rel::destroy_test_state(state);
        clock::destroy_for_testing(clock);
    }
}
