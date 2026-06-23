// SPDX-License-Identifier: MIT
#[test_only]
module upl::prepaid_ticket_tests {
    /// Tests for `upl::prepaid_ticket`.
    ///
    /// Covers: ticket creation carries the deposited amount; `consume` (the
    /// package-internal path the relayer uses) pulls `amount` and returns a
    /// `Balance<SUI>` of that size, aborting with `EInsufficientPrepaid` if the
    /// ticket cannot cover it; the read getters return what was deposited;
    /// and `balance` after `consume` reflects the delta. Uses the Sui 2024
    /// no-arg test form with `tx_context::dummy()`.
    ///
    /// Cleanup pattern: the leftover `Coin<SUI>` from `destroy_test_ticket`
    /// has no `drop`, so instead of an unavailable `coin::destroy_for_testing`
    /// (this rev has `coin::destroy_zero` only), we fold via
    /// `coin::into_balance` + `balance::destroy_zero` when zero, or
    /// `transfer::public_transfer` to a sink address when nonzero (the harness
    /// drops address-owned objects at test end). We prefer `destroy_zero` on
    /// fully-drained paths to keep the assertion explicit.

    use sui::balance;
    use sui::coin;
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::TxContext;
    use upl::prepaid_ticket as tik;

    /// Create + immediately tear down a ticket: proves the initial balance
    /// equals the seeded amount and the depositor is recorded. The full coin
    /// is forwarded to a sink (nonzero; harness reclaimable) since it carries
    /// real value.
    #[test]
    fun new_ticket_carries_amount_and_depositor() {
        let mut ctx = tx_context::dummy();
        let amount = 5_000_000;
        let ticket = tik::new_test_ticket(amount, @0xCAFE, &mut ctx);

        assert!(tik::balance(&ticket) == amount);
        assert!(tik::depositor(&ticket) == @0xCAFE);

        let coin = tik::destroy_test_ticket(ticket, &mut ctx);
        assert!(coin::value(&coin) == amount);
        transfer::public_transfer(coin, @0xBEEF);
    }

    /// `consume` extracts a sub-amount, returns a `Balance<SUI>` of that size,
    /// and leaves the ticket's balance reduced by exactly `take`.
    #[test]
    fun consume_pulls_amount_and_shrinks_balance() {
        let mut ctx = tx_context::dummy();
        let amount = 1_000_000;
        let mut ticket = tik::new_test_ticket(amount, @0xCAFE, &mut ctx);

        let take = 300_000;
        let bal = tik::consume(&mut ticket, @0xBEEF, take);

        assert!(balance::value(&bal) == take);
        assert!(tik::balance(&ticket) == amount - take);

        // The returned `Balance<SUI>` carries the *taken* funds (value == take,
        // nonzero), so it cannot be `balance::destroy_zero`'d; fold it back to
        // a Coin and ship to a sink. The leftover ticket balance routes the
        // same way below.
        let consumed_coin = coin::from_balance(bal, &mut ctx);
        transfer::public_transfer(consumed_coin, @0xBEEF);

        let coin = tik::destroy_test_ticket(ticket, &mut ctx);
        assert!(coin::value(&coin) == amount - take);
        transfer::public_transfer(coin, @0xBEEF);
    }

    /// `consume` the full balance leaves the ticket empty so a final
    /// zero-balance fold-back can use `coin::destroy_zero`.
    #[test]
    fun consume_full_drains_balance_to_zero() {
        let mut ctx = tx_context::dummy();
        let amount = 750_000;
        let mut ticket = tik::new_test_ticket(amount, @0xCAFE, &mut ctx);

        let bal = tik::consume(&mut ticket, @0xBEEF, amount);
        assert!(tik::balance(&ticket) == 0);

        // Returned `bal` == full amount (nonzero); fold to Coin -> sink.
        let consumed_coin = coin::from_balance(bal, &mut ctx);
        transfer::public_transfer(consumed_coin, @0xBEEF);

        let coin = tik::destroy_test_ticket(ticket, &mut ctx);
        assert!(coin::value(&coin) == 0);
        coin::destroy_zero(coin);
    }

    /// `consume` with `amount > balance` aborts with `EInsufficientPrepaid`
    /// (== 2). Cleanup after the aborting call only runs on the non-abort
    /// path, so a regression that *doesn't* abort surfaces as a leak failure.
    #[test, expected_failure(abort_code = 2)]
    fun consume_insufficient_aborts() {
        let mut ctx = tx_context::dummy();
        let amount = 100_000;
        let mut ticket = tik::new_test_ticket(amount, @0xCAFE, &mut ctx);
        let bal = tik::consume(&mut ticket, @0xBEEF, amount + 1);
        balance::destroy_zero(bal);
        let coin = tik::destroy_test_ticket(ticket, &mut ctx);
        transfer::public_transfer(coin, @0xBEEF);
    }

    /// Zero-amount ticket creation aborts with `EZeroAmount` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun new_ticket_zero_amount_aborts() {
        let mut ctx = tx_context::dummy();
        let ticket = tik::new_test_ticket(0, @0xCAFE, &mut ctx);
        let coin = tik::destroy_test_ticket(ticket, &mut ctx);
        transfer::public_transfer(coin, @0xBEEF);
    }
}
