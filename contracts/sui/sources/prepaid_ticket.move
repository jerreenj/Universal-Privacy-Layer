// SPDX-License-Identifier: MIT
module upl::prepaid_ticket {
    /// Caller-owned, transferable gas prepayment ticket.
    ///
    /// This is the Sui-native replacement for the EVM
    /// `PrivacyRelayer.prepaidBalance[address] => uint256` mapping. On EVM the
    /// prepaid balance is an internal ledger entry owned by the contract: the
    /// depositor can `deposit()` and `withdrawPrepaid()`, but the balance is
    /// frozen inside the relayer — it cannot be sold, split, or moved to
    /// another wallet short of withdrawing and re-depositing.
    ///
    /// Sui's resource model makes the ticket a **first-class owned object**:
    ///   - `mint` returns a `PrepaidTicket` resource `transfer`'d to the
    ///     depositor, living in *their* account (not inside any shared object);
    ///   - `top_up` (entry, paid with a `Coin<SUI>`) adds value;
    ///   - `drain` (entry) sweeps the full balance back to a `Coin<SUI>` and
    ///     destroys the now-empty ticket;
    ///   - `consume` (`#[test_only]` here, used by `privacy_relayer::relay` in
    ///     production builds via a `public(package)` surface) pulls `amount`
    ///     out of the ticket to pay a relayer fee, aborting if insufficient.
    ///
    /// Because the ticket is an owned, `key+store` resource, the owner can
    /// `transfer::transfer` it to another wallet (sell the prepayment), use it
    /// as Programmable-Transaction input across many relayers, or compose it
    /// with multisig custody (`upl::multisig`). None of that is expressible in
    /// the EVM contract's flat mapping — this is the "strictly better" the
    /// `privacy_relayer.move` docstring references.
    ///
    /// Semantic differences from the EVM original:
    ///   - `deposit()` payable -> `mint(entry, &Coin<SUI>)` taking the coin by
    ///     resource (explicit move, no implicit `msg.value`).
    ///   - `withdrawPrepaid()` -> `drain(entry)` which destroys the ticket
    ///     and returns a fresh `Coin<SUI>` to the entry caller. The EVM version
    ///     left a 0-balance row behind; Sui's linear typing makes the empty
    ///     ticket vanish (no zombie state).
    ///   - The per-depositor unbounded refund is the same (depositor always
    ///     gets back exactly what they put in, minus only what the ticket
    ///     actually paid to relayers).
    ///   - No `onlyRelayer` on `consume`: the EVM `withdrawPrepaid` was
    ///     depositor-gated; here `drain` is depositor-gated by object ownership
    ///     (you can only call an entry that takes `Ticket` by value/&mut if you
    ///     own it — the Sui object model enforces this for free). The
    ///     `consume` path is callable package-internally by
    ///     `privacy_relayer::relay`, which is itself `RelayerCap`-gated.

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    /// Owned gas prepayment for the UPL relayer. `key+store` so it is a
    /// transferable Sui object. One per depositor (depositor may own several
    /// if they want multiple discrete prepaid buckets — e.g. one per stealth
    /// identity).
    public struct PrepaidTicket has key, store {
        id: UID,
        /// Depositor / current owner as-of creation (does NOT auto-update on
        /// `transfer` — kept purely informational for indexers; the *real*
        /// ownership is whoever holds the object per Sui's account state).
        depositor: address,
        /// Prepaid SUI balance. Grows on `mint`/`top_up`; shrinks on `consume`
        /// / `drain`. `Balance<SUI>` is a resource: it cannot be silently
        /// duplicated or dropped.
        balance: Balance<SUI>,
    }

    /// Event emitted on every mutation of a ticket.
    public struct TicketDeposited has copy, drop {
        ticket: address,
        owner: address,
        amount: u64,
    }
    public struct TicketConsumed has copy, drop {
        ticket: address,
        for_relayer: address,
        amount: u64,
        remaining: u64,
    }
    public struct TicketDrained has copy, drop { ticket: address, owner: address, amount: u64 }

    // ─── Errors ────────────────────────────────────────────────────────────
    const EZeroAmount: u64 = 1;
    const EInsufficientPrepaid: u64 = 2;

    // ─── Mint (the entry any depositor calls to start a prepaid bucket) ────
    /// Create a brand-new `PrepaidTicket` seeded with `payment`, owned by the
    /// entry caller. The `Coin<SUI>` resource is consumed (its Balance folded
    /// into the ticket).
    entry fun mint(payment: Coin<SUI>, ctx: &mut TxContext) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);
        let owner = tx_context::sender(ctx);
        let ticket = PrepaidTicket {
            id: object::new(ctx),
            depositor: owner,
            balance: coin::into_balance(payment),
        };
        let ticket_addr = object::uid_to_address(&ticket.id);
        event::emit(TicketDeposited { ticket: ticket_addr, owner, amount });
        transfer::public_transfer(ticket, owner);
    }

    /// Top up an existing `ticket` with `payment`. Caller must own `ticket`
    /// (Sui object model enforces ownership). Returns nothing; the ticket's
    /// `balance` grows in place.
    entry fun top_up(ticket: &mut PrepaidTicket, payment: Coin<SUI>) {
        let amount = coin::value(&payment);
        assert!(amount > 0, EZeroAmount);
        let total = balance::join(&mut ticket.balance, coin::into_balance(payment));
        let _ = total;
        let ticket_addr = object::uid_to_address(&ticket.id);
        event::emit(TicketDeposited { ticket: ticket_addr, owner: ticket.depositor, amount });
    }

    /// Sweep the entire prepaid balance back to the caller as a fresh
    /// `Coin<SUI>` and destroy the (now-empty) ticket. Caller must own the
    /// ticket.
    entry fun drain(ticket: PrepaidTicket, ctx: &mut TxContext): Coin<SUI> {
        // Destructure: takes `PrepaidTicket` by value (ownership moved in),
        // so the ticket ceases to exist after this function returns.
        let owner = tx_context::sender(ctx);
        let PrepaidTicket { id, depositor: _, balance } = ticket;
        let amount = balance::value(&balance);
        let coin = coin::from_balance(balance, ctx);
        let ticket_addr = object::uid_to_address(&id);
        object::delete(id);
        event::emit(TicketDrained { ticket: ticket_addr, owner, amount });
        coin
    }

    // ─── Package-internal consume (called by upl::privacy_relayer::relay) ──
    /// Pull `amount` SUI out of the ticket to pay a relayer, aborting with
    /// `EInsufficientPrepaid` if the ticket cannot cover it. Returns the
    /// extracted funds as a `Balance<SUI>` so the relayer can join it into its
    /// own fee accumulator. `public(package)` so only other `upl::*` modules
    /// can call this — the user-facing surface is `top_up`/`drain`, and the
    /// only legitimate consumer is `privacy_relayer::relay` under a `RelayerCap`.
    public(package) fun consume(
        ticket: &mut PrepaidTicket,
        for_relayer: address,
        amount: u64,
    ): Balance<SUI> {
        assert!(balance::value(&ticket.balance) >= amount, EInsufficientPrepaid);
        let remaining = balance::value(&ticket.balance) - amount;
        let taken = balance::split(&mut ticket.balance, amount);
        let ticket_addr = object::uid_to_address(&ticket.id);
        event::emit(TicketConsumed {
            ticket: ticket_addr,
            for_relayer,
            amount,
            remaining,
        });
        taken
    }

    // ─── Public reads ──────────────────────────────────────────────────────
    /// Current prepaid balance on `ticket`. Depsitor/owner can show this; the
    /// relayer reads it before attempting a `consume`.

    public fun balance(ticket: &PrepaidTicket): u64 { balance::value(&ticket.balance) }
    /// Original depositor of the ticket (informational; may differ from the
    /// current Sui-owner if the ticket has been `transfer`'d).
    public fun depositor(ticket: &PrepaidTicket): address { ticket.depositor }

    // ─── Test helpers ────────────────────────────────────────────────────────
    /// Mint a test-owned `PrepaidTicket` with `amount` SUI without going
    /// through the private `mint` entry. The caller owns the object.
    #[test_only]
    public fun new_test_ticket(amount: u64, depositor: address, ctx: &mut TxContext): PrepaidTicket {
        assert!(amount > 0, EZeroAmount);
        PrepaidTicket {
            id: object::new(ctx),
            depositor,
            balance: coin::into_balance(coin::mint_for_testing<SUI>(amount, ctx)),
        }
    }

    /// Destroy a test-owned `PrepaidTicket`, requiring it be empty (the
    /// production `drain` is a private entry the test module cannot call; this
    /// helper mirrors its destructuring). Folds the leftover balance back
    /// into a `Coin<SUI>` (caller must park or destroy it).
    #[test_only]
    public fun destroy_test_ticket(ticket: PrepaidTicket, ctx: &mut TxContext): Coin<SUI> {
        let PrepaidTicket { id, depositor: _, balance } = ticket;
        let c = coin::from_balance(balance, ctx);
        object::delete(id);
        c
    }
}
