// SPDX-License-Identifier: MIT
#[test_only]
module upl::uopl_multisig_tests {
    /// Tests for `upl::uopl_multisig`.
    ///
    /// The multisig surface (`new_multisig`, `propose`, `approve`, `execute`)
    /// is entirely `public fun`. `new_multisig` ends in `transfer::share_object`,
    /// so shared-object testing must use `sui::test_scenario` (same convention
    /// the framework's own shared-object tests use — see
    /// `sui-framework/tests/authenticator_state_tests.move`).
    ///
    /// Covers: the four argument validators on `new_multisig` / `propose`
    /// (no-approvers, threshold-zero, threshold-too-high, zero-destination);
    /// a full 2-of-2 happy path where one tx proposes + the first approver
    /// approves, a second tx by the second approver approves + executes,
    /// moving a real `key + store` cap to the destination, verified by
    /// re-taking it from the destination's account in a follow-up tx; and the
    /// `ENotApprover`, `EAlreadyApproved`, and `EBelowThreshold` abort paths.

    use sui::object;
    use sui::test_scenario;
    use sui::transfer;
    use sui::tx_context::TxContext;
    use upl::uopl_multisig as ms;

    /// A throwaway `key + store` test object we mint + move through `execute`.
    /// The real-world targets are `AdminCap`/`RelayerCap`/`PrepaidTicket`, all
    /// `key + store`; a structurally identical placeholder exercises the
    /// generic `<T: key + store>` `execute` parameter.
    public struct TestCap has key, store { id: sui::object::UID }

    /// `new_multisig` aborts with `ENoApprovers` (== 1). The abort fires
    /// before `share_object`, so nothing is shared to return.
    #[test, expected_failure(abort_code = 1)]
    fun new_multisig_no_approvers_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[], 1, scenario.ctx());
        scenario.end();
    }

    /// `new_multisig` aborts with `EThresholdZero` (== 3).
    #[test, expected_failure(abort_code = 3)]
    fun new_multisig_threshold_zero_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA, @0xB], 0, scenario.ctx());
        scenario.end();
    }

    /// `new_multisig` aborts with `EThresholdTooHigh` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun new_multisig_threshold_too_high_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA, @0xB], 3, scenario.ctx());
        scenario.end();
    }

    /// `propose` to `@0x0` aborts with `EDestinationZero` (== 8). The multisig
    /// is properly created (and shared) first, then we take it shared and
    /// call `propose` which rejects the zero destination up front. The
    /// non-abort-path cleanup consumes the would-be-returned `Proposal` and
    /// returns the shared multisig so a regression that fails to abort
    /// surfaces as a leak-check failure instead of silently passing.
    #[test, expected_failure(abort_code = 8)]
    fun propose_zero_destination_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA], 1, scenario.ctx());
        scenario.next_tx(@0xA);
        let mut multisig = scenario.take_shared<ms::Multisig>();
        let proposal = ms::propose(&mut multisig, @0x0, scenario.ctx());
        transfer::public_transfer(proposal, @0xA);
        test_scenario::return_shared(multisig);
        scenario.end();
    }

    /// 2-of-2 happy path.
    ///   Tx @0xA: create multisig (shares it).
    ///   Tx @0xA: take shared, propose, first approval, return shared + park
    ///     the owned Proposal to @0xA's account.
    ///   Tx @0xB: take the parked Proposal from @0xA + take the shared multisig,
    ///     second approval (reaches threshold), mint a `TestCap`, execute
    ///     (consumes the Proposal by value; transfers the cap to the destination).
    ///   Tx @dest: re-take the cap from the destination's own account — proving
    ///     `execute` transferred it — and park it back (no `drop`).
    #[test]
    fun two_of_two_propose_approve_approve_execute_moves_cap() {
        let dest = @0xCAFE;
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA, @0xB], 2, scenario.ctx());

        // Tx @0xA: propose + first approval, then park the Proposal to @0xA.
        scenario.next_tx(@0xA);
        let mut multisig = scenario.take_shared<ms::Multisig>();
        let mut proposal = ms::propose(&mut multisig, dest, scenario.ctx());
        assert!(ms::proposal_destination(&proposal) == dest);
        assert!(ms::proposal_approvals(&proposal) == 0);
        ms::approve(&multisig, &mut proposal, scenario.ctx());
        assert!(ms::proposal_approvals(&proposal) == 1);
        assert!(!ms::proposal_executed(&proposal));
        assert!(ms::threshold(&multisig) == 2);
        assert!(ms::approvers_len(&multisig) == 2);
        assert!(ms::is_approver(&multisig, &@0xA));
        assert!(!ms::is_approver(&multisig, &dest));
        assert!(ms::nonce(&multisig) == 1);
        test_scenario::return_shared(multisig);
        transfer::public_transfer(proposal, @0xA);

        // Tx @0xB: take the parked Proposal from @0xA + take the shared
        // multisig, second approval, mint a cap, execute.
        scenario.next_tx(@0xB);
        let mut proposal = test_scenario::take_from_address<ms::Proposal>(&scenario, @0xA);
        let multisig = scenario.take_shared<ms::Multisig>();
        ms::approve(&multisig, &mut proposal, scenario.ctx());
        assert!(ms::proposal_approvals(&proposal) == 2);
        let cap = TestCap { id: object::new(scenario.ctx()) };
        ms::execute(&multisig, proposal, cap); // consumes proposal by value
        test_scenario::return_shared(multisig);

        // Tx @dest: re-take the cap, proving the execute transfer landed; park
        // it back (the cap has no `drop`, so we transfer to a sender-neutral sink).
        scenario.next_tx(dest);
        let recovered: TestCap = test_scenario::take_from_sender(&scenario);
        // The TestCap `id` is reclaimed via destructuring; we then transfer the
        // empty shell to the test sender's own address (harness-cleanable).
        let TestCap { id } = recovered;
        object::delete(id);
        scenario.end();
    }

    /// Non-approver cannot `approve`: aborts with `ENotApprover` (== 4). Tx
    /// @0xA creates a 1-of-1 multisig + proposes + parks the Proposal. Tx
    /// @0xBEEF (NOT an approver) takes the shared multisig + the Proposal and
    /// tries to approve — the ENotApprover guard fires.
    #[test, expected_failure(abort_code = 4)]
    fun non_approver_cannot_approve() {
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA], 1, scenario.ctx());
        scenario.next_tx(@0xA);
        let mut multisig = scenario.take_shared<ms::Multisig>();
        let mut proposal = ms::propose(&mut multisig, @0xCAFE, scenario.ctx());
        test_scenario::return_shared(multisig);
        transfer::public_transfer(proposal, @0xA);

        scenario.next_tx(@0xBEEF);
        let mut proposal = test_scenario::take_from_address<ms::Proposal>(&scenario, @0xA);
        let multisig = scenario.take_shared<ms::Multisig>();
        ms::approve(&multisig, &mut proposal, scenario.ctx());
        transfer::public_transfer(proposal, @0xBEEF);
        test_scenario::return_shared(multisig);
        scenario.end();
    }

    /// Same approver approving twice aborts with `EAlreadyApproved` (== 5).
    #[test, expected_failure(abort_code = 5)]
    fun double_approve_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA, @0xB], 1, scenario.ctx());
        scenario.next_tx(@0xA);
        let mut multisig = scenario.take_shared<ms::Multisig>();
        let mut proposal = ms::propose(&mut multisig, @0xCAFE, scenario.ctx());
        ms::approve(&multisig, &mut proposal, scenario.ctx());
        // Second approve by the same sender aborts.
        ms::approve(&multisig, &mut proposal, scenario.ctx());
        transfer::public_transfer(proposal, @0xA);
        test_scenario::return_shared(multisig);
        scenario.end();
    }

    /// Below-threshold execute aborts with `EBelowThreshold` (== 6). 2-of-2
    /// multisig: only one approval is recorded, then `execute` is attempted.
    #[test, expected_failure(abort_code = 6)]
    fun below_threshold_execute_aborts() {
        let dest = @0xCAFE;
        let mut scenario = test_scenario::begin(@0xA);
        ms::new_multisig(vector[@0xA, @0xB], 2, scenario.ctx());
        scenario.next_tx(@0xA);
        let mut multisig = scenario.take_shared<ms::Multisig>();
        let mut proposal = ms::propose(&mut multisig, dest, scenario.ctx());
        ms::approve(&multisig, &mut proposal, scenario.ctx()); // 1 of 2
        let cap = TestCap { id: object::new(scenario.ctx()) };
        ms::execute(&multisig, proposal, cap); // aborts EBelowThreshold
        test_scenario::return_shared(multisig);
        scenario.end();
    }
}
