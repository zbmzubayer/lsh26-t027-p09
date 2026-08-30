# Authentication and access control

The register is customer data — names, phone numbers, vehicles, what they owe.
It should not be open.

Three files: `src/lib/auth.ts` (primitives), `src/actions/auth.action.ts`
(flows), `src/proxy.ts` (route gating). Plus `src/lib/api.ts`, which is where
authorisation actually bites.

## Sessions

|          |                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------- |
| Token    | JWT, HS256, signed with `AUTH_SECRET` (≥32 chars, validated at boot by `src/config/env-private.ts`) |
| Payload  | `{ userId }` — nothing else, so a stale token cannot carry a stale workshop                         |
| Lifetime | 7 days (`setExpirationTime("7d")`, cookie `maxAge` matched)                                         |
| Cookie   | `session`, `httpOnly`, `sameSite: "lax"`, `secure` in production, `path: "/"`                       |
| Library  | [jose](https://github.com/panva/jose)                                                               |

`httpOnly` means no client JavaScript ever touches the token, so an XSS bug
cannot exfiltrate a session.

## Passwords

[argon2](https://github.com/ranisalt/node-argon2) with library defaults —
`hash()` on register, `verify()` on login. Minimum 8 characters
(`registerSchema`). Only `passwordHash` is stored; the plaintext is never
logged, returned or persisted.

Emails are lowercased on both write and lookup, so `A@b.com` and `a@b.com` are
one account.

## Route gating — `src/proxy.ts`

In this version of Next.js, middleware is `src/proxy.ts` exporting `proxy()`.

```
PROTECTED_ROUTES = ["/dashboard"]      no session  → redirect /login
AUTH_ROUTES      = ["/login", "/register"]  session → redirect /dashboard
```

The matcher covers everything except `_next/static`, `_next/image`, the favicon
and image files.

The proxy verifies the JWT signature only — it never hits the database, so it
stays cheap. `/dashboard/page.tsx` still calls `getCurrentUser()`, which is what
makes `user` non-null there and loads `caseId`.

## Authorisation — the part that matters

Route gating answers _"are you signed in?"_. Authorisation answers _"whose data
is this?"_, and here that is one question: **which workshop**.

```ts
// src/lib/api.ts
export async function requireWorkshop(): Promise<
  { caseId: string; userId: string } | NextResponse
>;
```

- `caseId` comes from the **session**, resolved through the database on every
  request. It is never read from a query string, a body field, or a header.
- No workshop on the account → **409**, with an explanation. Defaulting into
  someone else's book would be worse than saying so.
- Every data route calls it first and returns early via the `denied()` type
  guard.

Because ids are unique only within a case, and every Prisma key includes
`caseId`, a request scoped by the session's `caseId` **cannot** reach another
workshop's rows even if it guesses a valid `V01`.

`POST /api/run` deliberately does not use this: it is stateless, takes a whole
case in the body, and never touches the database, so there is nothing to scope.

## Flows

```
register → Zod → email taken? → argon2 hash → create user (caseId = null)
         → sign JWT → set cookie → redirect /dashboard → "No workshop assigned"

login    → Zod → find by lowercased email → argon2 verify
         → sign JWT → set cookie → redirect /dashboard

logout   → clear cookie (maxAge 0) → redirect /login
```

`src/validations/auth.validation.ts` holds the Zod schemas and the `LoginDto` /
`RegisterDto` types; `src/components/auth/` holds the three form components,
which use react-hook-form with the Zod resolver.

## Known gaps

Honest, and deliberate for the event's scope:

- **No workshop assignment flow.** `User.caseId` is set by hand in the database.
  A newly registered account sees "No workshop assigned".
- **No password reset, email verification, or account lockout.** No rate
  limiting on login, so the argon2 cost is the only brute-force brake.
- **No roles.** Every signed-in user of a workshop can read and write all of it.
- **No refresh/rotation.** The 7-day token is valid until it expires; logout
  clears the cookie but does not revoke the token server-side.
