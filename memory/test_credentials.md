# Test Credentials

> ⚠️ **DO NOT commit real secrets to this file.**
>
> Previous versions of this file contained live production credentials
> (VPS root password, app access code). Those have been **removed and rotated**.
> Real values now live only in:
> - The server environment (VPS shell env / `.env` on the host, never in git)
> - Your password manager
>
> If you need to share credentials with a teammate, use a secret manager
> (1Password, Bitwarden, GitHub Secrets, etc.) — never this repo.

## Access Gate
- Access Code: `<set via ACCESS_CODE env var on the server — never commit here>`

## Test Wallet Address
- Vitalik (for analyzer testing): `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`  (public address, safe to share)

## VPS (Hostinger)
- IP: `<set in your password manager>`
- User: `root`
- Password: `<ROTATED — stored in password manager only>`
- Project path: `/root/app/`
- Docker container: `privacycloak`
