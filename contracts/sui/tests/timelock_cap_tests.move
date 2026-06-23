// SPDX-License-Identifier: MIT
#[test_only]
module upl::timelock_cap_tests {
    /// Tests for `upl::timelock_cap`.
    ///
    /// The timelock module is somewhat unusual: `deposit` transfers the cap
    /// to the timelock's own object address (parking it), and `withdraw`/
    /// `cancel` take the cap back from that address via a PTB. In the test
    /// environment we exercise the state management (is_locked, field
    /// correctness, abort conditions) rather than the full park/unpark flow,
    /// because the generic `take_from_address<T>` is a native Sui runtime
    /// function not directly callable from Move unit tests.
    ///
    /// Covers: deposit sets fields; deposit while occupied aborts; deposit
    /// with too-short delay aborts; withdraw before delay aborts; is_locked
    /// state; set_min_delay works; cancel by depositor succeeds; cancel by
    /// non-depositor aborts; withdraw by non-beneficiary aborts.
    ///
    /// All tests use the Sui 2024 no-arg form.

    use sui::clock;
    use sui::object;
    use sui::test_scenario;
    use sui::transfer;
    use sui::tx_context::TxContext;
    use upl::timelock_cap as tl;

    fun fresh_clock(ctx: &mut TxContext): clock::Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, 1_000_000);
        c
    }

    /// A throwaway `key + store` test object for exercising the deposit
    /// generic.
    public struct TestCap has key, store { id: sui::object::UID }

    /// Deposit a TestCap: the lock becomes occupied, all fields are correct.
    #[test]
    fun deposit_locks_cap_and_sets_fields() {
        let mut scenario = test_scenario::begin(@0xA);
        let clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        assert!(!tl::is_locked(&timelock));
        assert!(tl::min_delay_ms(&timelock) == 1000);

        tl::deposit<TestCap>(
            &mut timelock,
            @0xB,
            10_000,
            cap,
            &clock,
            scenario.ctx(),
        );

        assert!(tl::is_locked(&timelock));
        assert!(tl::depositor(&timelock) == @0xA);
        assert!(tl::beneficiary(&timelock) == @0xB);
        assert!(tl::unlock_at_ms(&timelock) == 1_010_000);

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Deposit while the lock is already occupied aborts with
    /// `ELockOccupied` (== 1).
    #[test, expected_failure(abort_code = 1)]
    fun deposit_while_occupied_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap1 = TestCap { id: object::new(scenario.ctx()) };
        let cap2 = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0xB, 10_000, cap1, &clock, scenario.ctx());
        // Second deposit while occupied → abort.
        tl::deposit<TestCap>(&mut timelock, @0xC, 10_000, cap2, &clock, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Deposit with delay < min_delay_ms aborts with `EDelayTooShort` (== 7).
    #[test, expected_failure(abort_code = 7)]
    fun deposit_delay_too_short_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        // min_delay_ms == 1000, but we try delay == 500.
        tl::deposit<TestCap>(&mut timelock, @0xB, 500, cap, &clock, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Deposit with zero beneficiary aborts with `EZeroBeneficiary` (== 6).
    #[test, expected_failure(abort_code = 6)]
    fun deposit_zero_beneficiary_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0x0, 10_000, cap, &clock, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Withdraw before the timelock expires aborts with `ETooEarly` (== 3).
    /// We deposit with the clock at T=1_000_000 and delay=10_000, so the
    /// unlock time is 1_010_000. We try to withdraw at T=1_000_000 (before).
    #[test, expected_failure(abort_code = 3)]
    fun withdraw_too_early_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0xB, 10_000, cap, &clock, scenario.ctx());

        // Switch sender to beneficiary and attempt withdraw at T=1_000_000.
        scenario.next_tx(@0xB);
        // Take the parked cap from the timelock's address.
        let parked_cap = test_scenario::take_from_address<TestCap>(
            &scenario,
            object::uid_to_address(&timelock.id),
        );
        // Attempt withdraw (clock still at 1_000_000 < 1_010_000).
        tl::withdraw<TestCap>(&mut timelock, parked_cap, &clock, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Withdraw by a non-beneficiary aborts with `ENotBeneficiary` (== 5).
    #[test, expected_failure(abort_code = 5)]
    fun withdraw_by_non_beneficiary_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0xB, 10_000, cap, &clock, scenario.ctx());

        // Advance clock past unlock time.
        clock::set_for_testing(&mut clock, 2_000_000);

        // Sender @0xC (not the beneficiary) tries to withdraw.
        scenario.next_tx(@0xC);
        let parked_cap = test_scenario::take_from_address<TestCap>(
            &scenario,
            object::uid_to_address(&timelock.id),
        );
        tl::withdraw<TestCap>(&mut timelock, parked_cap, &clock, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Withdraw succeeds after the delay: the beneficiary takes the cap,
    /// the lock becomes empty.
    #[test]
    fun withdraw_after_delay_succeeds() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0xB, 10_000, cap, &clock, scenario.ctx());

        // Advance clock past unlock time (1_010_000).
        clock::set_for_testing(&mut clock, 1_020_000);

        // Switch to beneficiary.
        scenario.next_tx(@0xB);
        assert!(tl::is_locked(&timelock));

        let parked_cap = test_scenario::take_from_address<TestCap>(
            &scenario,
            object::uid_to_address(&timelock.id),
        );
        tl::withdraw<TestCap>(&mut timelock, parked_cap, &clock, scenario.ctx());

        // Lock is empty now.
        assert!(!tl::is_locked(&timelock));
        assert!(tl::beneficiary(&timelock) == @0x0);
        assert!(tl::unlock_at_ms(&timelock) == 0);

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Cancel by the original depositor returns the cap and clears the lock.
    #[test]
    fun cancel_by_depositor_succeeds() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0xB, 10_000, cap, &clock, scenario.ctx());
        assert!(tl::is_locked(&timelock));

        // Cancel in the same tx (depositor is @0xA).
        let parked_cap = test_scenario::take_from_address<TestCap>(
            &scenario,
            object::uid_to_address(&timelock.id),
        );
        tl::cancel<TestCap>(&mut timelock, parked_cap, scenario.ctx());

        assert!(!tl::is_locked(&timelock));
        assert!(tl::depositor(&timelock) == @0x0);

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Cancel by a non-depositor aborts with `ENotDepositor` (== 4).
    #[test, expected_failure(abort_code = 4)]
    fun cancel_by_non_depositor_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::deposit<TestCap>(&mut timelock, @0xB, 10_000, cap, &clock, scenario.ctx());

        // Switch sender to @0xC (not the depositor).
        scenario.next_tx(@0xC);
        let parked_cap = test_scenario::take_from_address<TestCap>(
            &scenario,
            object::uid_to_address(&timelock.id),
        );
        tl::cancel<TestCap>(&mut timelock, parked_cap, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// `set_min_delay` updates the minimum delay for future deposits.
    #[test]
    fun set_min_delay_works() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let admin = tl::new_test_admin_cap(scenario.ctx());

        assert!(tl::min_delay_ms(&timelock) == 1000);

        tl::set_min_delay(&admin, &mut timelock, 72_000_000); // 72 seconds in ms

        assert!(tl::min_delay_ms(&timelock) == 72_000_000);

        tl::destroy_test_admin_cap(admin);
        tl::destroy_test_timelock(timelock);
        scenario.end();
    }

    /// Withdraw on an empty lock aborts with `ELockEmpty` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun withdraw_empty_lock_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut clock = fresh_clock(scenario.ctx());
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };
        // No deposit — lock is empty.

        tl::withdraw<TestCap>(&mut timelock, cap, &clock, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        clock::destroy_for_testing(clock);
        scenario.end();
    }

    /// Cancel on an empty lock aborts with `ELockEmpty` (== 2).
    #[test, expected_failure(abort_code = 2)]
    fun cancel_empty_lock_aborts() {
        let mut scenario = test_scenario::begin(@0xA);
        let mut timelock = tl::new_test_timelock(scenario.ctx());
        let cap = TestCap { id: object::new(scenario.ctx()) };

        tl::cancel<TestCap>(&mut timelock, cap, scenario.ctx());

        tl::destroy_test_timelock(timelock);
        scenario.end();
    }

    /// Reads on an empty lock return zero/sentinel values.
    #[test]
    fun empty_lock_reads() {
        let mut scenario = test_scenario::begin(@0xA);
        let timelock = tl::new_test_timelock(scenario.ctx());

        assert!(!tl::is_locked(&timelock));
        assert!(tl::depositor(&timelock) == @0x0);
        assert!(tl::beneficiary(&timelock) == @0x0);
        assert!(tl::unlock_at_ms(&timelock) == 0);

        tl::destroy_test_timelock(timelock);
        scenario.end();
    }
}
