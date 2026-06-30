//! # UPL Solana — Universal Privacy Layer (Solana / SVM)
//!
//! Parity implementation of the Universal Privacy Layer on Solana, mirroring
//! the Base (EVM) PrivacyRelayer + StealthAddressRegistry and the Sui (Move)
//! stealth_transfer + privacy_relayer + privacy_receipt modules.
//!
//! ## Capabilities (parity with Base + Sui)
//!
//! | Capability             | Sui (Move)              | Solana (this program)           |
//! |------------------------|-------------------------|---------------------------------|
//! | Stealth announcements  | Registry (shared obj)   | Announcement PDA accounts       |
//! | Relayed private send   | relayed_send (PTB)      | relay_and_announce instruction  |
//! | Receive/scan surface   | /api/sui/announcements  | /api/sol/announcements          |
//! | Encrypted receipts     | PrivacyReceipt objects  | PrivacyReceipt PDA accounts     |
//! | Atomic compose         | one PTB (Move advantage)| one tx (Solana native atomicity)|
//!
//! ## Architecture
//!
//! Solana's account model differs from both EVM (contract storage) and Sui
//! (shared objects). State lives in PDA (Program Derived Address) accounts
//! that are deterministically derived from seeds. All instructions in a
//! transaction execute atomically — if any fails, the entire tx reverts.
//! This gives us the atomic announce+relay+receipt compose for free, just
//! like Sui's PTB and Base's relayAndAnnounce.
//!
//! ## Trust model
//!
//! Identical to Base + Sui: the relayer is an authorized wallet that fronts
//! SOL and pays gas. The user signs an off-chain intent; the relayer validates
//! it and submits the on-chain transaction. The user's wallet never appears
//! as the transaction signer for private sends — only the relayer's does.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::hash::hash;

declare_id!("F7MQRA15YwswZoLK319rs1sr35Km2KBfqvPgR7TPnp1t");

// ─── Constants ──────────────────────────────────────────────────────────────

/// Fee denominator — 10000 basis points. Mirrors Base FEE_DENOMINATOR + Sui.
pub const FEE_DENOMINATOR: u64 = 10_000;
/// Hard cap on fee: 100 bps = 1%. Mirrors Base MAX_FEE_BPS + Sui max_fee_bps.
pub const MAX_FEE_BPS: u16 = 100;
/// Default fee: 5 bps = 0.05%. Mirrors Base/Sui default.
pub const DEFAULT_FEE_BPS: u16 = 5;

// ─── Error codes ────────────────────────────────────────────────────────────

#[error_code]
pub enum UplError {
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Invalid recipient (zero address)")]
    ZeroRecipient,
    #[msg("Not authorised relayer — only the configured relayer may call this")]
    NotAuthorizedRelayer,
    #[msg("Not authorised admin — only the initializer may call this")]
    NotAuthorizedAdmin,
    #[msg("Fee too high — exceeds MAX_FEE_BPS (1%)")]
    FeeTooHigh,
    #[msg("Empty ephemeral public key")]
    EmptyEphemeralKey,
    #[msg("Empty view tag")]
    EmptyViewTag,
    #[msg("Registry not initialized — call initialize first")]
    RegistryNotInitialized,
    #[msg("Recipient == program — would self-lock fees")]
    RecipientIsProgram,
    #[msg("Empty ciphertext")]
    EmptyCiphertext,
    #[msg("Empty nonce")]
    EmptyNonce,
    #[msg("Announcement already exists at this id")]
    AnnouncementAlreadyExists,
    #[msg("Receipt already exists at this id")]
    ReceiptAlreadyExists,
}

// ─── Events (mirror Sui event names) ────────────────────────────────────────

#[event]
pub struct PrivateTransfer {
    pub stealth_hash: [u8; 32],
    pub ephemeral_key: [u8; 32],
    pub view_tag: u8,
    pub amount: u64,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct StealthAnnouncement {
    pub id: u64,
    pub view_tag: u8,
    pub announcer: Pubkey,
    pub stealth_hash: [u8; 32],
    pub ephemeral_pub_key: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct ReceiptIssued {
    pub receipt_id: u64,
    pub recipient: Pubkey,
    pub announcement_id: u64,
    pub timestamp: i64,
    pub ciphertext_len: u64,
    pub nonce_len: u64,
}

#[event]
pub struct PrivateSendCompleted {
    pub relayed: bool,
    pub recipient: Pubkey,
    pub announcement_id: u64,
    pub net_amount: u64,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct FeeRateUpdated {
    pub old_rate: u16,
    pub new_rate: u16,
}

#[event]
pub struct FeesWithdrawn {
    pub to: Pubkey,
    pub amount: u64,
}

// ─── State accounts ─────────────────────────────────────────────────────────

/// Registry state — the single shared configuration + stats account.
/// PDA derived from seeds `["registry"]`. Created once by `initialize`.
/// Mirrors Sui's `Registry` (next_id) + `RelayerState` (fee, total_relayed)
/// combined into one account (Solana favors fewer accounts per tx).
///
/// Space: 8 (discriminator) + 32 (relayer) + 32 (admin) + 2 (fee_bps) +
///        8 (next_id) + 8 (total_relayed) + 8 (accumulated_fees) + 8 (next_receipt_id) = 106
#[account]
pub struct RegistryState {
    /// The authorized relayer wallet (msg.sender analog). Only this address
    /// may call `relay` / `relay_and_announce`. Mirrors Base `relayer` slot.
    pub relayer: Pubkey,
    /// The admin (initializer). Only this address may call `set_fee_bps` /
    /// `withdraw_fees`. Usually the deployer. Mirrors Sui AdminCap holder.
    pub admin: Pubkey,
    /// Fee in basis points (5 = 0.05%). Capped at MAX_FEE_BPS. Mirrors Base feeBps.
    pub fee_bps: u16,
    /// Monotonic announcement counter — also the next announcement id.
    /// Mirrors Sui Registry.next_id.
    pub next_id: u64,
    /// Cumulative lamports forwarded to stealth recipients. Mirrors Base totalRelayed.
    pub total_relayed: u64,
    /// Accrued fees in lamports, withdrawable by admin. Mirrors Base accumulatedFees.
    pub accumulated_fees: u64,
    /// Monotonic receipt counter — also the next receipt id.
    /// Mirrors Sui PrivacyReceipt issuance sequence.
    pub next_receipt_id: u64,
}

impl RegistryState {
    pub const SPACE: usize = 8 + 32 + 32 + 2 + 8 + 8 + 8 + 8; // = 106

    pub fn fee_for(&self, amount: u64) -> u64 {
        (amount * self.fee_bps as u64) / FEE_DENOMINATOR
    }
}

/// Announcement — a single stealth address announcement record.
/// PDA derived from seeds `["announce", id.to_le_bytes()]`.
/// Mirrors Sui `Announcement` struct + Base StealthAddressRegistry.Announcement.
///
/// Space: 8 (discriminator) + 8 (id) + 32 (ephemeral_pub_key) + 1 (view_tag) +
///        32 (stealth_hash) + 32 (announcer) + 8 (timestamp) = 121
#[account]
pub struct Announcement {
    /// Announcement id (0-based, matches RegistryState.next_id at creation time).
    pub id: u64,
    /// 32-byte ephemeral public key commitment (x-only coord or hash).
    /// The recipient uses this to derive the shared secret. Mirrors Sui ephemeral_pub_key.
    pub ephemeral_pub_key: [u8; 32],
    /// 1-byte EIP-5564 view tag for fast client-side scan filtering.
    pub view_tag: u8,
    /// keccak256 of the derived stealth address (recipient lookup — NOT the address).
    pub stealth_hash: [u8; 32],
    /// The relayer/announcer Pubkey (msg.sender analog). Mirrors Sui announcer.
    pub announcer: Pubkey,
    /// Unix timestamp (seconds). Mirrors Sui timestamp_ms (divided to seconds).
    pub timestamp: i64,
}

impl Announcement {
    pub const SPACE: usize = 8 + 8 + 32 + 1 + 32 + 32 + 8; // = 121
}

/// PrivacyReceipt — encrypted delivery receipt owned by the recipient.
/// PDA derived from seeds `["receipt", id.to_le_bytes()]`.
/// Mirrors Sui `PrivacyReceipt` owned object + Base event-log receipt.
///
/// Space: 8 (discriminator) + 8 (id) + 32 (recipient) + 4 (ciphertext len) +
///        256 (ciphertext max) + 4 (nonce len) + 32 (nonce max) + 8 (announcement_id) +
///        8 (timestamp) = 360
#[account]
pub struct PrivacyReceipt {
    /// Receipt id (0-based, matches RegistryState.next_receipt_id at creation).
    pub id: u64,
    /// The recipient's Pubkey — who owns this receipt account.
    pub recipient: Pubkey,
    /// Encrypted delivery payload (the recipient decrypts with their view key).
    /// Max 256 bytes — sufficient for the MVP encrypted metadata.
    pub ciphertext: [u8; 256],
    /// Length of the ciphertext (the fixed array is zero-padded beyond this).
    pub ciphertext_len: u16,
    /// Nonce for the encrypted payload.
    pub nonce: [u8; 32],
    /// Length of the nonce.
    pub nonce_len: u16,
    /// The announcement id this receipt corresponds to.
    pub announcement_id: u64,
    /// Unix timestamp (seconds).
    pub timestamp: i64,
}

impl PrivacyReceipt {
    pub const SPACE: usize = 8 + 8 + 32 + 256 + 2 + 32 + 2 + 8 + 8; // = 358
}


// ─── Account validation structs (crate root) ──────────────────────────────

/// Initialize the registry — creates the RegistryState PDA and sets the
/// relayer + admin + fee. Called once by the deployer. Mirrors Sui `init`
/// (which mints AdminCap + RelayerCap to the publisher) + Base constructor.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = RegistryState::SPACE,
        seeds = [b"registry"],
        bump
    )]
    pub registry: Account<'info, RegistryState>,

    /// The authorized relayer wallet. For solo-relayer MVP this is the deployer.
    /// CHECK: validated in the instruction body (stored, not used for signing).
    pub relayer: AccountInfo<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Announce a stealth address — creates an Announcement PDA. Permissionless
/// (anyone can announce), but typically called by the relayer. Mirrors Sui
/// `stealth_address_registry::announce`.
#[derive(Accounts)]
pub struct Announce<'info> {
    #[account(mut)]
    pub registry: Account<'info, RegistryState>,

    #[account(
        init,
        payer = announcer,
        space = Announcement::SPACE,
        seeds = [b"announce", registry.next_id.to_le_bytes().as_ref()],
        bump
    )]
    pub announcement: Account<'info, Announcement>,

    #[account(mut)]
    pub announcer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Relay SOL to a stealth recipient (announce-less path). Relayer-gated.
/// Skims the fee, forwards `amount - fee` via System Program transfer.
/// Mirrors Sui `privacy_relayer::relay` + Base `relay()`. Kept for
/// backward-compat — `relay_and_announce` is the preferred entry.
#[derive(Accounts)]
pub struct Relay<'info> {
    #[account(mut, has_one = relayer)]
    pub registry: Account<'info, RegistryState>,

    /// The authorized relayer — must match registry.relayer. Enforced by has_one.
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// CHECK: the stealth recipient. Validated != zero + != program in body.
    /// Receives `amount - fee` via system_program transfer.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// **THE PARITY ENTRY POINT** — atomically announce + relay SOL + issue receipt
/// in ONE instruction. If any sub-step fails, the entire transaction reverts
/// (Solana's native atomicity — same guarantee as Sui's PTB and Base's
/// relayAndAnnounce). Mirrors Sui `stealth_transfer::relayed_send`.
///
/// Side effects (all atomic):
///   1. Create Announcement PDA, increment registry.next_id
///   2. Transfer `amount - fee` SOL to the stealth recipient via System Program CPI
///   3. Create PrivacyReceipt PDA, increment registry.next_receipt_id
///   4. Update registry.total_relayed + accumulated_fees
///   5. Emit PrivateTransfer + StealthAnnouncement + ReceiptIssued + PrivateSendCompleted
#[derive(Accounts)]
pub struct RelayAndAnnounce<'info> {
    #[account(mut, has_one = relayer)]
    pub registry: Account<'info, RegistryState>,

    /// The authorized relayer — must match registry.relayer. Enforced by has_one.
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// CHECK: the stealth recipient. Validated != zero + != program in body.
    /// Receives `amount - fee` via system_program transfer.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(
        init,
        payer = relayer,
        space = Announcement::SPACE,
        seeds = [b"announce", registry.next_id.to_le_bytes().as_ref()],
        bump
    )]
    pub announcement: Account<'info, Announcement>,

    #[account(
        init,
        payer = relayer,
        space = PrivacyReceipt::SPACE,
        seeds = [b"receipt", registry.next_receipt_id.to_le_bytes().as_ref()],
        bump
    )]
    pub receipt: Account<'info, PrivacyReceipt>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RelayAndAnnounceWithRecipient<'info> {
    #[account(mut, has_one = relayer)]
    pub registry: Account<'info, RegistryState>,

    #[account(mut)]
    pub relayer: Signer<'info>,

    /// CHECK: validated in body
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(
        init,
        payer = relayer,
        space = Announcement::SPACE,
        seeds = [b"announce", registry.next_id.to_le_bytes().as_ref()],
        bump
    )]
    pub announcement: Account<'info, Announcement>,

    #[account(
        init,
        payer = relayer,
        space = PrivacyReceipt::SPACE,
        seeds = [b"receipt", registry.next_receipt_id.to_le_bytes().as_ref()],
        bump
    )]
    pub receipt: Account<'info, PrivacyReceipt>,

    pub system_program: Program<'info, System>,
}

/// Issue a standalone receipt (relayer-gated). Mirrors Sui
/// `privacy_receipt::issue`. Used when a receipt is needed outside the
/// atomic relay_and_announce flow.
#[derive(Accounts)]
pub struct IssueReceipt<'info> {
    #[account(mut, has_one = relayer)]
    pub registry: Account<'info, RegistryState>,

    #[account(mut)]
    pub relayer: Signer<'info>,

    /// CHECK: the receipt recipient. Stored, not used for signing.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(
        init,
        payer = relayer,
        space = PrivacyReceipt::SPACE,
        seeds = [b"receipt", registry.next_receipt_id.to_le_bytes().as_ref()],
        bump
    )]
    pub receipt: Account<'info, PrivacyReceipt>,

    pub system_program: Program<'info, System>,
}

/// Set the fee rate (admin-only). Mirrors Sui `set_fee_bps` + Base `setFeeBps`.
#[derive(Accounts)]
pub struct SetFeeBps<'info> {
    #[account(mut, has_one = admin)]
    pub registry: Account<'info, RegistryState>,

    /// The admin — must match registry.admin. Enforced by has_one.
    #[account(mut)]
    pub admin: Signer<'info>,
}

/// Withdraw accrued fees (admin-only). Transfers accumulated_fees lamports
/// from the registry PDA to the admin. Mirrors Sui `withdraw_fees` + Base
/// `withdrawFees`.
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut, has_one = admin)]
    pub registry: Account<'info, RegistryState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: the destination for the withdrawn fees. Usually == admin.
    #[account(mut)]
    pub to: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Close the program (admin-only) — returns all SOL to the admin.
/// For emergency shutdown. Mirrors Sui's package upgrade capability
/// (Solana has no upgrade authority in the program itself, but the
/// deployer can close via BPF upgrade authority separately).
#[derive(Accounts)]
pub struct Close<'info> {
    #[account(mut, has_one = admin, close = admin)]
    pub registry: Account<'info, RegistryState>,

    #[account(mut)]
    pub admin: Signer<'info>,
}


#[program]
pub mod upl_sol {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, UplError::FeeTooHigh);

    let registry = &mut ctx.accounts.registry;
    registry.relayer = ctx.accounts.relayer.key();
    registry.admin = ctx.accounts.payer.key();
    registry.fee_bps = fee_bps;
    registry.next_id = 0;
    registry.total_relayed = 0;
    registry.accumulated_fees = 0;
    registry.next_receipt_id = 0;

    Ok(())
    }

    pub fn announce(
    ctx: Context<Announce>,
    ephemeral_pub_key: [u8; 32],
    view_tag: u8,
    stealth_hash: [u8; 32],
    ) -> Result<()> {
    require!(
        ephemeral_pub_key != [0u8; 32],
        UplError::EmptyEphemeralKey
    );

    let registry = &mut ctx.accounts.registry;
    let announcement = &mut ctx.accounts.announcement;

    let id = registry.next_id;
    registry.next_id += 1;

    announcement.id = id;
    announcement.ephemeral_pub_key = ephemeral_pub_key;
    announcement.view_tag = view_tag;
    announcement.stealth_hash = stealth_hash;
    announcement.announcer = ctx.accounts.announcer.key();
    announcement.timestamp = Clock::get()?.unix_timestamp;

    emit!(StealthAnnouncement {
        id,
        view_tag,
        announcer: ctx.accounts.announcer.key(),
        stealth_hash,
        ephemeral_pub_key,
        timestamp: announcement.timestamp,
    });

    Ok(())
    }

    pub fn relay(ctx: Context<Relay>, _ephemeral_key: [u8; 32], _view_tag: u8, amount: u64) -> Result<()> {
    let registry = &mut ctx.accounts.registry;

    require!(amount > 0, UplError::ZeroAmount);
    require!(!ctx.accounts.recipient.key().eq(&Pubkey::default()), UplError::ZeroRecipient);
    require!(
        !ctx.accounts.recipient.key().eq(&crate::ID),
        UplError::RecipientIsProgram
    );
    require!(registry.fee_bps <= MAX_FEE_BPS, UplError::FeeTooHigh);

    let fee = registry.fee_for(amount);
    let transfer_amount = amount
        .checked_sub(fee)
        .ok_or_else(|| error!(UplError::FeeTooHigh))?;

    // Forward amount - fee to the stealth recipient via System Program CPI.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.relayer.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
        ),
        transfer_amount,
    )?;

    // The fee stays with the relayer (it was part of the amount the relayer
    // fronted). We track accumulated_fees for accounting — the relayer can
    // later withdraw them via withdraw_fees. This mirrors Base's pattern where
    // the fee accrues in the contract; here it accrues conceptually with the
    // relayer but is tracked on-chain for stats/transparency.
    registry.accumulated_fees = registry
        .accumulated_fees
        .checked_add(fee)
        .ok_or_else(|| error!(UplError::ZeroAmount))?;
    registry.total_relayed = registry
        .total_relayed
        .checked_add(transfer_amount)
        .ok_or_else(|| error!(UplError::ZeroAmount))?;

    let stealth_hash = hash(&ctx.accounts.recipient.key().to_bytes()).to_bytes();
    emit!(PrivateTransfer {
        stealth_hash,
        ephemeral_key: _ephemeral_key,
        view_tag: _view_tag,
        amount: transfer_amount,
        fee,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
    }

    pub fn relay_and_announce(
    ctx: Context<RelayAndAnnounce>,
    ephemeral_pub_key: [u8; 32],
    view_tag: u8,
    stealth_hash: [u8; 32],
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    amount: u64,
    ) -> Result<()> {
    let registry = &mut ctx.accounts.registry;

    // ── Validate ────────────────────────────────────────────────────────
    require!(amount > 0, UplError::ZeroAmount);
    require!(!ctx.accounts.recipient.key().eq(&Pubkey::default()), UplError::ZeroRecipient);
    require!(
        !ctx.accounts.recipient.key().eq(&crate::ID),
        UplError::RecipientIsProgram
    );
    require!(registry.fee_bps <= MAX_FEE_BPS, UplError::FeeTooHigh);
    require!(ephemeral_pub_key != [0u8; 32], UplError::EmptyEphemeralKey);
    require!(!ciphertext.is_empty(), UplError::EmptyCiphertext);
    require!(!nonce.is_empty(), UplError::EmptyNonce);
    require!(ciphertext.len() <= 256, UplError::EmptyCiphertext);
    require!(nonce.len() <= 32, UplError::EmptyNonce);

    let fee = registry.fee_for(amount);
    let transfer_amount = amount
        .checked_sub(fee)
        .ok_or_else(|| error!(UplError::FeeTooHigh))?;

    // ── 1. Create Announcement PDA ──────────────────────────────────────
    let announcement_id = registry.next_id;
    registry.next_id += 1;

    let announcement = &mut ctx.accounts.announcement;
    announcement.id = announcement_id;
    announcement.ephemeral_pub_key = ephemeral_pub_key;
    announcement.view_tag = view_tag;
    announcement.stealth_hash = stealth_hash;
    announcement.announcer = ctx.accounts.relayer.key();
    announcement.timestamp = Clock::get()?.unix_timestamp;

    // ── 2. Transfer amount - fee SOL to the stealth recipient ───────────
    // This is a CPI to the System Program. If it fails, the whole tx reverts
    // — the Announcement PDA creation above is rolled back too. Atomicity.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.relayer.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
        ),
        transfer_amount,
    )?;

    // ── 3. Create PrivacyReceipt PDA ────────────────────────────────────
    let receipt_id = registry.next_receipt_id;
    registry.next_receipt_id += 1;

    let receipt = &mut ctx.accounts.receipt;
    receipt.id = receipt_id;
    receipt.recipient = ctx.accounts.recipient.key();
    receipt.ciphertext = [0u8; 256];
    receipt.ciphertext[..ciphertext.len()].copy_from_slice(&ciphertext);
    receipt.ciphertext_len = ciphertext.len() as u16;
    receipt.nonce = [0u8; 32];
    receipt.nonce[..nonce.len()].copy_from_slice(&nonce);
    receipt.nonce_len = nonce.len() as u16;
    receipt.announcement_id = announcement_id;
    receipt.timestamp = Clock::get()?.unix_timestamp;

    // ── 4. Update registry stats ────────────────────────────────────────
    registry.accumulated_fees = registry
        .accumulated_fees
        .checked_add(fee)
        .ok_or_else(|| error!(UplError::ZeroAmount))?;
    registry.total_relayed = registry
        .total_relayed
        .checked_add(transfer_amount)
        .ok_or_else(|| error!(UplError::ZeroAmount))?;

    // ── 5. Emit events ──────────────────────────────────────────────────
    emit!(StealthAnnouncement {
        id: announcement_id,
        view_tag,
        announcer: ctx.accounts.relayer.key(),
        stealth_hash,
        ephemeral_pub_key,
        timestamp: announcement.timestamp,
    });

    emit!(PrivateTransfer {
        stealth_hash,
        ephemeral_key: ephemeral_pub_key,
        view_tag,
        amount: transfer_amount,
        fee,
        timestamp: announcement.timestamp,
    });

    emit!(ReceiptIssued {
        receipt_id,
        recipient: ctx.accounts.recipient.key(),
        announcement_id,
        timestamp: receipt.timestamp,
        ciphertext_len: ciphertext.len() as u64,
        nonce_len: nonce.len() as u64,
    });

    emit!(PrivateSendCompleted {
        relayed: true,
        recipient: ctx.accounts.recipient.key(),
        announcement_id,
        net_amount: transfer_amount,
        fee,
        timestamp: announcement.timestamp,
    });

    Ok(())
    }

    pub fn issue_receipt(
    ctx: Context<IssueReceipt>,
    announcement_id: u64,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    ) -> Result<()> {
    require!(!ciphertext.is_empty(), UplError::EmptyCiphertext);
    require!(!nonce.is_empty(), UplError::EmptyNonce);
    require!(ciphertext.len() <= 256, UplError::EmptyCiphertext);
    require!(nonce.len() <= 32, UplError::EmptyNonce);
    require!(!ctx.accounts.recipient.key().eq(&Pubkey::default()), UplError::ZeroRecipient);

    let registry = &mut ctx.accounts.registry;
    let receipt_id = registry.next_receipt_id;
    registry.next_receipt_id += 1;

    let receipt = &mut ctx.accounts.receipt;
    receipt.id = receipt_id;
    receipt.recipient = ctx.accounts.recipient.key();
    receipt.ciphertext = [0u8; 256];
    receipt.ciphertext[..ciphertext.len()].copy_from_slice(&ciphertext);
    receipt.ciphertext_len = ciphertext.len() as u16;
    receipt.nonce = [0u8; 32];
    receipt.nonce[..nonce.len()].copy_from_slice(&nonce);
    receipt.nonce_len = nonce.len() as u16;
    receipt.announcement_id = announcement_id;
    receipt.timestamp = Clock::get()?.unix_timestamp;

    emit!(ReceiptIssued {
        receipt_id,
        recipient: ctx.accounts.recipient.key(),
        announcement_id,
        timestamp: receipt.timestamp,
        ciphertext_len: ciphertext.len() as u64,
        nonce_len: nonce.len() as u64,
    });

    Ok(())
    }

    pub fn set_fee_bps(ctx: Context<SetFeeBps>, new_fee_bps: u16) -> Result<()> {
    require!(new_fee_bps <= MAX_FEE_BPS, UplError::FeeTooHigh);

    let registry = &mut ctx.accounts.registry;
    let old = registry.fee_bps;
    registry.fee_bps = new_fee_bps;

    emit!(FeeRateUpdated {
        old_rate: old,
        new_rate: new_fee_bps,
    });

    Ok(())
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    let amount = registry.accumulated_fees;
    require!(amount > 0, UplError::ZeroAmount);

    registry.accumulated_fees = 0;

    // Transfer from the registry PDA to the destination. The registry PDA
    // holds the fees as its lamport balance — we use a raw transfer since
    // the PDA is owned by our program, not the System Program.
    **registry.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.to.try_borrow_mut_lamports()? += amount;

    emit!(FeesWithdrawn {
        to: ctx.accounts.to.key(),
        amount,
    });

    Ok(())
    }

    pub fn close(_ctx: Context<Close>) -> Result<()> {
    Ok(())
    }

}
