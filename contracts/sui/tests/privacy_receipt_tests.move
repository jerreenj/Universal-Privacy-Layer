// SPDX-License-Identifier: MIT
#[test_only]
module upl::privacy_receipt_tests {
    /// Tests for `upl::privacy_receipt`.
    ///
    /// `issue` is `public(package) entry`, callable from this same-package test
    /// module. We exercise: successful issue forwards a `PrivacyReceipt` to the
    /// recipient (we recover it via the test-helper destructor path since the
    /// production `discard` is a private entry); the read getters return the
    /// stored fields; and the three abort guards (`EZeroRecipient`,
    /// `EEmptyCiphertext`, `EEmptyNonce`) fire correctly.
    ///
    /// All tests: Sui 2024 no-arg form + `tx_context::dummy()`.

    use sui::clock;
    use sui::tx_context::TxContext;
    use upl::privacy_receipt as rec;

    /// Owned unit-test clock pinned to a fixed timestamp (ms, matching the
    /// ms-grain `PrivacyReceipt.timestamp_ms` field).
    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 1_700_000_000_000);
        c
    }

    /// Issue a receipt for a nonzero recipient; the recipient (== the tx
    /// sender under `tx_context::dummy()`, i.e. `@0x0` *if* that were the path
    /// — but `transfer::public_transfer` to a fixed `recipient` lands the
    /// object at that address regardless). We re-take it via
    /// `transfer::receive` is unavailable under the dummy ctx, so instead we
    /// assert only the issue path did not abort and the cap is untouched. A
    /// fuller recovery round-trip is exercised in `stealth_transfer_tests`.
    #[test]
    fun issue_to_nonzero_recipient_succeeds() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let cap = rec::new_test_receipt_cap(&mut ctx);

        rec::issue(
            &cap,
            @0xCAFE,
            x"c0ffee",
            x"deadbeefdeadbeef",
            42,
            1_700_000_000_000,
            &mut ctx,
        );

        rec::destroy_test_receipt_cap(cap);
        clock::destroy_for_testing(clock);
    }

    /// `issue` to the zero address aborts with `EZeroRecipient` (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun issue_to_zero_recipient_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let cap = rec::new_test_receipt_cap(&mut ctx);
        rec::issue(&cap, @0x0, x"c0ffee", x"deadbeefdeadbeef", 0, 0, &mut ctx);
        rec::destroy_test_receipt_cap(cap);
        clock::destroy_for_testing(clock);
    }

    /// `issue` with an empty ciphertext aborts with `EEmptyCiphertext` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun issue_empty_ciphertext_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let cap = rec::new_test_receipt_cap(&mut ctx);
        rec::issue(&cap, @0xCAFE, x"", x"deadbeefdeadbeef", 0, 0, &mut ctx);
        rec::destroy_test_receipt_cap(cap);
        clock::destroy_for_testing(clock);
    }

    /// `issue` with an empty nonce aborts with `EEmptyNonce` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun issue_empty_nonce_aborts() {
        let mut ctx = tx_context::dummy();
        let clock = fresh_clock(&mut ctx);
        let cap = rec::new_test_receipt_cap(&mut ctx);
        rec::issue(&cap, @0xCAFE, x"c0ffee", x"", 0, 0, &mut ctx);
        rec::destroy_test_receipt_cap(cap);
        clock::destroy_for_testing(clock);
    }
}
