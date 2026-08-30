# Workshop accounts — plan

Three things: a manager can put a colleague on the books, anyone can change their
own password, and everyone gets a page showing who they are.

Written against the code as it stands at `31e0c20`.

---

## The naming trap, first

**`Owner` in this codebase is the customer** — the person whose car it is
(`prisma/schema.prisma`, `engine.ts`, the call list). The workshop's boss is
_not_ an `Owner`; `User` is workshop staff, and `README.md` calls the boss "the
manager".

So the role is **`manager`**, never `owner`. A role named `owner` would collide
with the model that means the opposite thing, in a codebase where
`requireWorkshop()`, `CallRow.owner` and `data.owners` are all about customers.
That confusion would land in a security check, which is the worst place for it.

## Where it stands today

|                    |                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `User`             | `id, name, email, passwordHash, caseId?, createdAt, updatedAt`. **No role**                                         |
| Getting an account | Anyone self-registers at `/register`; `caseId` is `null`                                                            |
| Getting a workshop | Manual `UPDATE "User" SET "caseId" = …` in psql                                                                     |
| Permissions        | Every signed-in user of a workshop can read and write all of it                                                     |
| Session            | JWT `{ userId }`, 7 days, HTTP-only cookie. `caseId` and everything else is read from the database on every request |

That last row is the useful one: because nothing but `userId` is in the token, a
role or workshop change **takes effect on the next request** with no token
rotation. Keep it that way.

---

## Decisions

### D1 · How a new user gets in — _manager sets a starting password_

**Recommended.** The manager fills in name, email and a starting password, and
tells the person. One form, one Server Action, no new tables, no email service,
no token expiry logic. A workshop is a room with people in it; the manager can
say the password out loud.

The alternative, if you would rather no one else ever knows a password: the
colleague self-registers at `/register`, and the manager attaches them by typing
their exact email — the manual `UPDATE` turned into a button. Cheaper still (no
password handling at all), but it is two steps in two places and the manager
cannot finish the job alone. **Take the recommendation unless someone objects to
the manager knowing a starting password.**

Either way, `passwordChangedAt` (below) means the starting password stops
working for the manager the moment the colleague changes it.

### D2 · Where it lives — _a dashboard tab_

**Recommended.** `/dashboard` is already one tabbed client component behind
`proxy.ts`, the `user` prop already flows in from the server component, and the
`.duebook` styling is already there. `["account", "Account"]` in `TABS` is the
whole routing change.

A separate `/account` route is the alternative — cleaner separation, but it
needs a new page, a new entry in `PROTECTED_ROUTES`, and its own data load, for
a screen most people open twice a year.

### D3 · Public registration — _close it, once managers can invite_

Right now anyone on the internet can create an account. They see nothing (no
`caseId`, no book), so it is not a leak — but once a manager can create staff,
open registration is a spam vector with no remaining purpose. **The first
account of a workshop still has to come from somewhere,** so do not remove
`/register` until there is a way to bootstrap a workshop; the honest interim is
to leave it and say so in the limitations.

---

## Schema

```prisma
enum StaffRole {
  manager
  staff
}

model User {
  // …existing fields
  role              StaffRole @default(staff)
  /// Set on every password change; sessions issued before it stop working.
  passwordChangedAt DateTime?
}
```

Additive only — `prisma db push` adds a column with a default and an enum type,
no data loss, no consent gate. One backfill afterwards, because the people who
set the workshops up are the managers:

```sql
UPDATE "User" SET role = 'manager' WHERE "caseId" IS NOT NULL;
```

New self-registrations then land as `staff` with no workshop, which is correct:
they can do nothing until a manager attaches them.

## Server side

### `src/lib/auth.ts`

- `getCurrentUser()` — add `role` to the `select`.
- **Session invalidation.** `getSession()` already returns the jose payload,
  which carries `iat`. In `getCurrentUser()`:

  ```ts
  if (
    user.passwordChangedAt &&
    (session.iat ?? 0) * 1000 < user.passwordChangedAt.getTime()
  )
    return null;
  ```

  Four lines, and it closes the real gap: today a password change leaves every
  other session — including one held by whoever knew the old password — valid
  for the rest of its seven days. `proxy.ts` only verifies the signature, so it
  will still let the request through to a page; `getCurrentUser()` returning
  null is what makes that page redirect. Good enough, and worth stating.

### `src/lib/api.ts`

```ts
export async function requireManager(): Promise<
  { caseId: string; userId: string } | NextResponse
>;
```

Same shape and the same early-return `denied()` pattern as `requireWorkshop()`,
with a **403** when the role is not `manager`. Do not fork the logic — call
`requireWorkshop()` and add the role check, so the workshop-from-session rule
has exactly one implementation.

### `src/actions/auth.action.ts` (or a new `staff.action.ts`)

| Action                  | Guard     | Does                                                                                                                                                                              |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addWorkshopUser(data)` | manager   | Creates a `User` with `caseId` **from the session**, `role: "staff"`, argon2 hash. Returns the updated staff list                                                                 |
| `changePassword(data)`  | signed in | Verifies the current password with argon2, writes the new hash and `passwordChangedAt`, then **re-issues the caller's own cookie** so they are not logged out by their own change |

Both return the existing `ActionResult` discriminated union rather than
throwing, matching `login`/`register`.

### `src/validations/auth.validation.ts`

Reuse `registerSchema` verbatim for the add-user form — same name, email,
password rules, same 8-character minimum. Add one schema:

```ts
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .trim(),
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    message: "The new password must be different",
    path: ["newPassword"],
  });
```

## UI

`src/app/dashboard/page.tsx` already resolves the user server-side. Widen what
it passes:

```tsx
<DueBook
  user={{ name, email, role, caseId, createdAt }}
  staff={user.role === "manager" ? await listWorkshopUsers(user.caseId) : null}
  caseId={user.caseId}
/>
```

`src/components/account/account.tsx`, rendered as the `account` tab:

- **Who you are** — name, email, role, the workshop you work out of, member
  since. Read-only; `caseId` is not a thing a user gets to change about
  themselves.
- **Change password** — current, new, confirm. react-hook-form + `zodResolver`,
  exactly like `register-form.tsx`.
- **Staff, managers only** — the workshop's users with role and joined date, and
  an "Add someone" form. Seed the list from the `staff` prop, replace it with
  what `addWorkshopUser` returns. No new API route, no query key, no refetch.

Non-managers never receive the `staff` prop, so the list is absent rather than
hidden with CSS.

---

## The rules that must not be simplified away

1. **`caseId` for the new user comes from the session**, never from the form —
   the same rule `requireWorkshop()` already enforces everywhere else. A manager
   must not be able to post a colleague into another workshop.
2. **The role check is server-side.** Hiding the tab is presentation; the action
   must refuse.
3. **`changePassword` verifies the current password.** A live session is not
   proof that the person at the keyboard knows the password.
4. **Email is globally unique.** "Email already registered" and nothing more —
   never name the workshop the address belongs to.
5. **Passwords go through `hashPassword()`.** Never log, return or echo one back,
   including the starting password the manager just typed.

## Skipped on purpose

| Skipped                                           | Add it when                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Email invitations, reset links, a token table     | Staff are not in the same room as the manager                                                 |
| `mustChangePassword` on first login               | The workshop has more than a handful of staff, or a starting password lives longer than a day |
| Remove / deactivate a user, change someone's role | Someone leaves. It needs a last-manager guard, which is the actual work                       |
| An audit trail of who created whom                | There is a dispute worth resolving                                                            |
| Rate limiting on login and change-password        | Note today: there is none, and argon2's cost is the only brute-force brake                    |
| Roles beyond `manager` / `staff`                  | A third kind of person exists                                                                 |

## Verification

One runnable check, `src/lib/auth-check.ts`, over the pure parts — no database,
no framework:

- `sessionIsStale(iat, passwordChangedAt)` — true just after a change, false for
  a token issued after it, false when `passwordChangedAt` is null
- `changePasswordSchema` rejects a short password, an empty current password,
  and a new password identical to the old one
- `registerSchema` still accepts what the add-user form sends

Plus two things to do by hand once, because they cross the session boundary and
a unit test would only be testing a mock:

1. Manager in PUB-02 adds a user → sign in as them → they see PUB-02's book and
   **only** PUB-02's.
2. Change the password in one browser → the other browser's session is dead on
   its next request, and the one that made the change is still signed in.

## Order and effort

| #   | Step                                                                  | Effort |
| --- | --------------------------------------------------------------------- | ------ |
| 1   | `role` + `passwordChangedAt`, `db push`, backfill, `requireManager()` | 30 min |
| 2   | `changePassword` + session invalidation + cookie re-issue             | 1 h    |
| 3   | The Account tab: who you are, change password                         | 1 h    |
| 4   | `addWorkshopUser` + the staff list, manager-gated                     | 1.5 h  |

Half a day. Steps 1–3 are useful on their own; step 4 is the one that needs the
role, so nothing before it is wasted if the answer to D1 changes.
