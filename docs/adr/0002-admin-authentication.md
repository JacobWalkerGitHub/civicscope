# ADR 0002: Admin authentication

Date: 2026-11-02 · Status: accepted

## Decision

Admin sign-in uses email + password with server-side sessions, implemented in
`packages/auth`, instead of Auth.js with magic links or Google sign-in (the original plan).

## Why

- Magic links need an email-sending service (SES or similar) configured before anyone can
  sign in; Google sign-in needs OAuth credentials. Both add setup before Phase 1 can be used.
- Auth.js's credentials provider does not support database sessions, which we need so that
  sign-out, disabling a user and "sign out everywhere" take effect immediately.
- The code is small and fully tested against MySQL.

## Details

- Passwords: Argon2id (m=19 MiB, t=2, p=1), minimum 12 characters.
- Sessions: 32 random bytes in an httpOnly, SameSite=Lax cookie (`__Host-` prefixed and
  Secure in production); only the SHA-256 of the token is stored. Sessions last 12 hours.
- Lockout: 5 failures per email or 20 per IP in 15 minutes block sign-in for that window.
  Unknown emails take the same path (a dummy hash is verified) and get the same message.
- Authorization: every admin page and server action calls `requirePermission(...)` on the
  server; roles and permissions are defined once in `@civicscope/core`.
- CSRF: Next.js server actions compare the Origin header with the host; cookies are SameSite=Lax.

## Follow-ups

- TOTP two-factor sign-in for owner and reviewer accounts (before public launch).
- Invite, disable and change-role screens in the admin (users are created by CLI for now).

## Addendum: invitations, user management and two-step sign-in (Phase 1, part 5)

- **Invitations.** Owners create a one-time link (random token, hash stored, 3-day expiry,
  revocable). The invitee picks their own name and password; email and role come from
  the invitation. There is no email service yet, so the owner sends the link themselves.
- **User management** is owner-only and audited: change role, disable or re-enable,
  reset two-step sign-in. Nobody can change their own role or disable themselves, and
  CivicScope always keeps at least one active owner. Disabling or a role change signs
  the user out everywhere.
- **Two-step sign-in** uses standard authenticator-app codes (RFC 6238 TOTP,
  implemented with `node:crypto`, checked against the RFC test vectors). Secrets are
  encrypted at rest with AES-256-GCM using `AUTH_ENCRYPTION_KEY`. A code is never
  accepted twice. After a correct password, a short-lived challenge (5 minutes, 5 tries)
  stands between the password and the session; wrong codes count toward the account
  lockout. Ten single-use recovery codes are issued (only hashes stored).
- **Policy.** With `ADMIN_REQUIRE_TWO_STEP=true` (production), owners and reviewers
  can't use anything but their account page until two-step sign-in is on.
