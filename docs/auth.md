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

## Roles

`User.role` is `manager` or `staff`, defaulting to `staff`.

**It is not called `owner`, deliberately.** `Owner` in this schema is the
_customer_ — the person whose car it is. A role named `owner` would mean the
opposite of the model sitting next to it, in the file where the permission check
lives.

| Role      | Can                                                                        |
| --------- | -------------------------------------------------------------------------- |
| `manager` | Everything staff can, plus see the workshop's accounts and add a colleague |
| `staff`   | Read and work the book                                                     |

The role is read from the database on every request (`getCurrentUser()`), not
carried in the token, so a change takes effect on the next request with no
token rotation.

`currentManager()` in `src/lib/auth.ts` is the single implementation of "is a
manager, and which workshop" — the actions that mint and list accounts both go
through it, and `caseId` comes from there rather than from a form.

## Retiring sessions on a password change

There is no session store, so a signed JWT is valid until it expires. That
leaves a real hole: change your password and whoever knew the old one still
holds a cookie good for the rest of its seven days.

`User.passwordChangedAt` closes it. `getCurrentUser()` compares it to the
token's `iat`:

```ts
sessionIsStale(iat, passwordChangedAt); // src/lib/auth.ts, pure and asserted
```

- Compared at **second** granularity, because `iat` is whole seconds while
  `passwordChangedAt` carries milliseconds. Without the floor, the very cookie
  issued by the change would look older than the change and log the user out of
  their own action. The cost is a one-second window.
- A token with no `iat` is treated as stale — fail closed.
- `changePassword` re-issues the caller's own cookie **after** the write, so
  they stay signed in and every other browser does not.
- `proxy.ts` still only verifies the signature, so a retired session reaches the
  page; `getCurrentUser()` returning null is what redirects it. Worth knowing
  when reading the flow.

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

- **The first account of a workshop is still assigned by hand.** A manager can
  add colleagues, but somebody has to make the first manager —
  `UPDATE "User" SET "caseId" = …, role = 'manager'`. Until then a newly
  registered account sees "No workshop assigned".
- **Public registration is still open.** It grants nothing (no workshop, no
  book), but it has no remaining purpose either; see D3 in
  `plans/ACCOUNTS-PLAN.md`.
- **A starting password is set by the manager**, shown on screen so they can
  read it out. There is no forced change on first login — the colleague changing
  it is what locks the manager out of their account.
- **No password reset or email verification.** No rate limiting on login or on
  the change-password action, so the argon2 cost is the only brute-force brake.
- **No remove, deactivate or role change.** When someone leaves, it is a
  database statement. Doing it properly needs a last-manager guard, which is the
  actual work.
- **Retiring a session is all-or-nothing.** A password change ends every other
  session; there is no way to sign out one device. That needs a session store.
