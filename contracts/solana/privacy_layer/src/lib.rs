use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("UPLreLaYer1111111111111111111111111111111111");

// Fee: 0.05% = 5 basis points
const FEE_BPS: u64 = 5;
const BPS_DENOM: u64 = 10_000;

#[program]
pub mod privacy_layer {
    use super::*;

    /// Initialize the global Privacy Relayer state
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u64) -> Result<()> {
        let relayer = &mut ctx.accounts.relayer;
        relayer.owner = ctx.accounts.owner.key();
        relayer.fee_bps = if fee_bps == 0 { FEE_BPS } else { fee_bps };
        relayer.total_relayed = 0;
        relayer.fees_collected = 0;
        relayer.bump = ctx.bumps.relayer;
        Ok(())
    }

    /// Relay a private SOL payment to a stealth address
    /// ephemeral_key: one-time pubkey sender generates for this transfer
    /// stealth_address: recipient's one-time stealth address (off-chain computed)
    pub fn relay_payment(
        ctx: Context<RelayPayment>,
        amount_lamports: u64,
        ephemeral_key: [u8; 33],
        view_tag: u8,
    ) -> Result<()> {
        require!(amount_lamports > 0, PrivacyError::ZeroAmount);

        let fee = (amount_lamports * ctx.accounts.relayer.fee_bps) / BPS_DENOM;
        let transfer_amount = amount_lamports.checked_sub(fee).ok_or(PrivacyError::Overflow)?;

        // Transfer main amount to stealth address
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.sender.to_account_info(),
                    to: ctx.accounts.stealth_address.to_account_info(),
                },
            ),
            transfer_amount,
        )?;

        // Transfer fee to fee vault
        if fee > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.sender.to_account_info(),
                        to: ctx.accounts.fee_vault.to_account_info(),
                    },
                ),
                fee,
            )?;
        }

        let relayer = &mut ctx.accounts.relayer;
        relayer.total_relayed = relayer.total_relayed.saturating_add(transfer_amount);
        relayer.fees_collected = relayer.fees_collected.saturating_add(fee);

        emit!(PrivateTransferEvent {
            sender: ctx.accounts.sender.key(),
            stealth_address: ctx.accounts.stealth_address.key(),
            amount: transfer_amount,
            ephemeral_key,
            view_tag,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Register stealth meta-address (spend + view public keys)
    pub fn register_stealth_keys(
        ctx: Context<RegisterStealthKeys>,
        spend_pub_key: [u8; 33],
        view_pub_key: [u8; 33],
    ) -> Result<()> {
        let record = &mut ctx.accounts.stealth_record;
        record.owner = ctx.accounts.user.key();
        record.spend_pub_key = spend_pub_key;
        record.view_pub_key = view_pub_key;
        record.registered_at = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.stealth_record;

        emit!(StealthMetaAddressSet {
            user: ctx.accounts.user.key(),
            spend_pub_key,
            view_pub_key,
        });

        Ok(())
    }

    /// Announce ephemeral key so recipient can scan and find payment
    pub fn announce_ephemeral_key(
        ctx: Context<AnnounceKey>,
        stealth_address: Pubkey,
        ephemeral_pub_key: [u8; 33],
        view_tag: u8,
    ) -> Result<()> {
        emit!(EphemeralKeyAnnouncement {
            sender: ctx.accounts.sender.key(),
            stealth_address,
            ephemeral_pub_key,
            view_tag,
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Owner withdraws collected fees
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        let relayer = &mut ctx.accounts.relayer;
        require!(ctx.accounts.owner.key() == relayer.owner, PrivacyError::Unauthorized);
        require!(amount <= relayer.fees_collected, PrivacyError::InsufficientFees);

        relayer.fees_collected = relayer.fees_collected.saturating_sub(amount);

        **ctx.accounts.fee_vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += amount;

        Ok(())
    }
}

// ===== Accounts =====

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + PrivacyRelayer::INIT_SPACE,
        seeds = [b"privacy_relayer"],
        bump
    )]
    pub relayer: Account<'info, PrivacyRelayer>,

    #[account(
        init,
        payer = owner,
        space = 8,
        seeds = [b"fee_vault"],
        bump
    )]
    pub fee_vault: SystemAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RelayPayment<'info> {
    #[account(mut, seeds = [b"privacy_relayer"], bump = relayer.bump)]
    pub relayer: Account<'info, PrivacyRelayer>,

    #[account(mut, seeds = [b"fee_vault"], bump)]
    pub fee_vault: SystemAccount<'info>,

    #[account(mut)]
    pub sender: Signer<'info>,

    /// CHECK: Recipient stealth address (derived off-chain, safe to send to)
    #[account(mut)]
    pub stealth_address: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterStealthKeys<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + StealthRecord::INIT_SPACE,
        seeds = [b"stealth", user.key().as_ref()],
        bump
    )]
    pub stealth_record: Account<'info, StealthRecord>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AnnounceKey<'info> {
    #[account(mut)]
    pub sender: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(mut, seeds = [b"privacy_relayer"], bump = relayer.bump)]
    pub relayer: Account<'info, PrivacyRelayer>,

    #[account(mut, seeds = [b"fee_vault"], bump)]
    pub fee_vault: SystemAccount<'info>,

    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ===== State =====

#[account]
#[derive(InitSpace)]
pub struct PrivacyRelayer {
    pub owner: Pubkey,
    pub fee_bps: u64,
    pub total_relayed: u64,
    pub fees_collected: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct StealthRecord {
    pub owner: Pubkey,
    pub spend_pub_key: [u8; 33],
    pub view_pub_key: [u8; 33],
    pub registered_at: i64,
    pub bump: u8,
}

// ===== Events =====

#[event]
pub struct PrivateTransferEvent {
    pub sender: Pubkey,
    pub stealth_address: Pubkey,
    pub amount: u64,
    pub ephemeral_key: [u8; 33],
    pub view_tag: u8,
    pub timestamp: i64,
}

#[event]
pub struct StealthMetaAddressSet {
    pub user: Pubkey,
    pub spend_pub_key: [u8; 33],
    pub view_pub_key: [u8; 33],
}

#[event]
pub struct EphemeralKeyAnnouncement {
    pub sender: Pubkey,
    pub stealth_address: Pubkey,
    pub ephemeral_pub_key: [u8; 33],
    pub view_tag: u8,
    pub timestamp: i64,
}

// ===== Errors =====

#[error_code]
pub enum PrivacyError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Only owner can withdraw fees")]
    Unauthorized,
    #[msg("Insufficient fees collected")]
    InsufficientFees,
}
