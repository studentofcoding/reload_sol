use anchor_lang::prelude::*;
use spl_token::instruction::close_account;

#[program]
pub mod auto_swap {
    use super::*;

    pub fn swap_and_close(ctx: Context<SwapAndClose>) -> Result<()> {
        // 1. Verify token account ownership
        let token_account = &ctx.accounts.token_account;
        let owner = &ctx.accounts.owner;
        
        require!(
            token_account.owner == owner.key(),
            ErrorCode::InvalidTokenAccountOwner
        );

        // 2. Perform swap logic (integrate with DEX CPI here)
        // ...

        // 3. Close empty token account
        let close_ix = close_account(
            &spl_token::ID,
            &token_account.key(),
            &owner.key(),
            &owner.key(),
            &[],
        )?;

        anchor_lang::solana_program::program::invoke(
            &close_ix,
            &[
                token_account.to_account_info(),
                owner.to_account_info(),
            ],
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct SwapAndClose<'info> {
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    // Add DEX program accounts as needed
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
} 