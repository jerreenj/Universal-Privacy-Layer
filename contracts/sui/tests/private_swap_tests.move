// SPDX-License-Identifier: MIT
#[test_only]
module upl::private_swap_tests {
    /// Tests for `upl::private_swap`.
    ///
    /// Covers: SUI-for-coin fee extraction + delivery, coin-for-SUI output-side
    /// fee, coin-for-coin no-fee pass-through, fee-rate admin setter, abort
    /// cases (zero amount, zero recipient, fee exceeds max), and the
    /// total_swapped monotonic counter.
    ///
    /// Uses the Sui 2024 no-arg test form. `SwapState` and `FeeSplitter` are
    /// owned test objects (not shared), so we exercise only the state logic —
    /// shared-object transaction mechanics are not under test here.

    use sui::clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::tx_context::TxContext;
    use upl::private_swap as swap;
    use upl::fee_splitter as fs;

    /// Helper: create a `Clock` at a deterministic timestamp for testing.
    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 1_700_000_000_000);
        c
    }

    /// SUI-for-coin: deposit 10_000_000 MIST, fee_bps=5 → fee = 10_000_000 *
    /// 5 / 10000 = 5000, net = 9_995_000. Verify fee_splitter accumulated and
    /// total_swapped.
    #[test]
    fun sui_for_coin_extracts_fee_and_delivers_net() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let cl = fresh_clock(&mut ctx);

        // Set up fee_splitter payees so distribute works (required to destroy).
        let fs_admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&fs_admin, &mut splitter, @0xA, 10000);
        fs::set_weights(&fs_admin, &mut splitter, vector[@0xA], vector[10000]);

        let payment = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        swap::private_swap_sui_for_coin(
            &mut state, &mut splitter, payment, @0xCAFE, &cl, &mut ctx,
        );

        // fee = 10_000_000 * 5 / 10000 = 5000
        assert!(fs::accumulated(&splitter) == 5000);
        // net = 10_000_000 - 5000 = 9_995_000
        assert!(swap::total_swapped(&state) == 9_995_000);

        // Distribute fees so the splitter accumulated balance is zero before teardown.
        fs::distribute(&fs_admin, &mut splitter, &mut ctx);

        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
        fs::destroy_test_admin_cap(fs_admin);
        fs::destroy_test_splitter(splitter);
        clock::destroy_for_testing(cl);
    }

    /// Coin-for-SUI: output-side fee. 10_000_000 MIST output with fee_bps=5
    /// → fee = 5000, net = 9_995_000 delivered to recipient.
    #[test]
    fun coin_for_sui_extracts_fee_and_delivers_net() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let cl = fresh_clock(&mut ctx);

        let fs_admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&fs_admin, &mut splitter, @0xA, 10000);
        fs::set_weights(&fs_admin, &mut splitter, vector[@0xA], vector[10000]);

        let output = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        swap::private_swap_coin_for_sui(
            &mut state, &mut splitter, output, @0xCAFE, &cl, &mut ctx,
        );

        // Same fee as sui_for_coin: fee = 10_000_000 * 5 / 10000 = 5000
        assert!(fs::accumulated(&splitter) == 5000);
        assert!(swap::total_swapped(&state) == 9_995_000);

        // Distribute fees so the splitter accumulated balance is zero before teardown.
        fs::distribute(&fs_admin, &mut splitter, &mut ctx);

        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
        fs::destroy_test_admin_cap(fs_admin);
        fs::destroy_test_splitter(splitter);
        clock::destroy_for_testing(cl);
    }

    /// Coin-for-coin: no fee (coin_coin_fee_bps = 0). Full 10_000_000 MIST
    /// delivered to recipient, fee_splitter unchanged, total_swapped = full.
    #[test]
    fun coin_for_coin_no_fee_full_delivery() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let cl = fresh_clock(&mut ctx);

        let fs_admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&fs_admin, &mut splitter, @0xA, 10000);
        fs::set_weights(&fs_admin, &mut splitter, vector[@0xA], vector[10000]);

        let input = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        swap::private_swap_coin_for_coin<SUI>(
            &mut state, &mut splitter, input, @0xCAFE, &cl, &mut ctx,
        );

        // No fee deducted for coin-for-coin path.
        assert!(fs::accumulated(&splitter) == 0);
        assert!(swap::total_swapped(&state) == 10_000_000);

        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
        fs::destroy_test_admin_cap(fs_admin);
        fs::destroy_test_splitter(splitter);
        clock::destroy_for_testing(cl);
    }

    /// Admin can set fee_bps from 5 to 10.
    #[test]
    fun set_fee_bps_updates_rate() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);

        assert!(swap::fee_bps(&state) == 5);
        swap::set_fee_bps(&admin, &mut state, 10);
        assert!(swap::fee_bps(&state) == 10);

        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
    }

    /// Admin can set coin_coin_fee_bps from 0 to 50.
    #[test]
    fun set_coin_coin_fee_bps_updates_rate() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);

        assert!(swap::coin_coin_fee_bps(&state) == 0);
        swap::set_coin_coin_fee_bps(&admin, &mut state, 50);
        assert!(swap::coin_coin_fee_bps(&state) == 50);

        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
    }

    /// `set_fee_bps` with value > MAX_FEE_BPS aborts with `EFeeExceedsMax`
    /// (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun set_fee_bps_exceeds_max_aborts() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);
        swap::set_fee_bps(&admin, &mut state, 101); // MAX_FEE_BPS == 100
        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
    }

    /// `private_swap_sui_for_coin` with zero amount aborts with `EZeroAmount`
    /// (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun swap_zero_amount_aborts() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let cl = fresh_clock(&mut ctx);

        let payment = coin::mint_for_testing<SUI>(0, &mut ctx);
        swap::private_swap_sui_for_coin(
            &mut state, &mut splitter, payment, @0xCAFE, &cl, &mut ctx,
        );

        swap::destroy_test_state(state);
        fs::destroy_test_splitter(splitter);
        clock::destroy_for_testing(cl);
    }

    /// `private_swap_sui_for_coin` with @0x0 recipient aborts with
    /// `EZeroRecipient` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun swap_zero_recipient_aborts() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let cl = fresh_clock(&mut ctx);

        let payment = coin::mint_for_testing<SUI>(1_000_000, &mut ctx);
        swap::private_swap_sui_for_coin(
            &mut state, &mut splitter, payment, @0x0, &cl, &mut ctx,
        );

        swap::destroy_test_state(state);
        fs::destroy_test_splitter(splitter);
        clock::destroy_for_testing(cl);
    }

    /// total_swapped increments correctly across multiple swaps.
    #[test]
    fun total_swapped_increments() {
        let mut ctx = tx_context::dummy();
        let mut state = swap::new_test_state(&mut ctx);
        let admin = swap::new_test_admin_cap(&mut ctx);
        let mut splitter = fs::new_test_splitter(&mut ctx);
        let cl = fresh_clock(&mut ctx);

        let fs_admin = fs::new_test_admin_cap(&mut ctx);
        fs::add_payee(&fs_admin, &mut splitter, @0xA, 10000);
        fs::set_weights(&fs_admin, &mut splitter, vector[@0xA], vector[10000]);

        assert!(swap::total_swapped(&state) == 0);

        // Swap 1: 10_000_000 MIST, fee = 5000, net = 9_995_000.
        let p1 = coin::mint_for_testing<SUI>(10_000_000, &mut ctx);
        swap::private_swap_sui_for_coin(
            &mut state, &mut splitter, p1, @0xCAFE, &cl, &mut ctx,
        );
        assert!(swap::total_swapped(&state) == 9_995_000);

        // Swap 2: 20_000_000 MIST, fee = 10_000, net = 19_990_000.
        let p2 = coin::mint_for_testing<SUI>(20_000_000, &mut ctx);
        swap::private_swap_sui_for_coin(
            &mut state, &mut splitter, p2, @0xCAFE, &cl, &mut ctx,
        );
        assert!(swap::total_swapped(&state) == 9_995_000 + 19_990_000);

        // Distribute fees so the splitter accumulated balance is zero before teardown.
        fs::distribute(&fs_admin, &mut splitter, &mut ctx);

        swap::destroy_test_admin_cap(admin);
        swap::destroy_test_state(state);
        fs::destroy_test_admin_cap(fs_admin);
        fs::destroy_test_splitter(splitter);
        clock::destroy_for_testing(cl);
    }
}
