// Run: npx -y tsx src/lib/auth-check.ts
//
// Nothing here touches the database, but importing auth.ts pulls in the env
// schema through prisma, so the .env has to parse — same as engine-check.ts.
import "dotenv/config";
import assert from "node:assert";
import {
  addUserSchema,
  changePasswordSchema,
} from "../validations/auth.validation";
import { sessionIsStale } from "./auth";

/* ---------------------------------------------------------------------------
 * Retiring a session on a password change.
 *
 * The token carries only `userId` and there is no session store, so this
 * comparison is the whole mechanism. Two ways it can be wrong, and both are
 * silent: too strict logs the user out of the change they just made, too loose
 * leaves whoever knew the old password signed in for another seven days.
 * ------------------------------------------------------------------------ */
{
  const at = (iso: string) => new Date(iso);
  const secs = (iso: string) => Math.floor(at(iso).getTime() / 1000);

  assert.strictEqual(
    sessionIsStale(secs("2026-08-30T10:00:00Z"), null),
    false,
    "an account that never changed its password lost its session",
  );
  assert.strictEqual(
    sessionIsStale(secs("2026-08-30T09:59:00Z"), at("2026-08-30T10:00:00Z")),
    true,
    "a token issued before the change survived it",
  );
  assert.strictEqual(
    sessionIsStale(secs("2026-08-30T10:01:00Z"), at("2026-08-30T10:00:00Z")),
    false,
    "a token issued after the change was rejected",
  );
  // the millisecond trap: iat is whole seconds, passwordChangedAt is not. The
  // cookie re-issued by the change must survive its own change.
  assert.strictEqual(
    sessionIsStale(
      secs("2026-08-30T10:00:00Z"),
      at("2026-08-30T10:00:00.500Z"),
    ),
    false,
    "the cookie issued by the change was invalidated by it",
  );
  // fail closed: a token with no iat is not trusted against a known change
  assert.strictEqual(
    sessionIsStale(undefined, at("2026-08-30T10:00:00Z")),
    true,
    "a token with no issued-at was trusted",
  );
}

/* ---------------------------------------------------------------------------
 * The two forms.
 * ------------------------------------------------------------------------ */
{
  const pw = (currentPassword: string, newPassword: string) =>
    changePasswordSchema.safeParse({ currentPassword, newPassword }).success;

  assert.ok(
    pw("whatever-it-was", "a-new-long-one"),
    "a good change was refused",
  );
  assert.ok(!pw("", "a-new-long-one"), "the current password was not required");
  assert.ok(!pw("whatever-it-was", "short"), "a short password was accepted");
  assert.ok(
    !pw("same-password-1", "same-password-1"),
    "the password was allowed to stay the same",
  );

  const add = (name: string, email: string, password: string) =>
    addUserSchema.safeParse({ name, email, password }).success;

  assert.ok(
    add("Rahim Uddin", "rahim@workshop.test", "at-least-eight"),
    "a valid colleague was refused",
  );
  assert.ok(
    !add("", "rahim@workshop.test", "at-least-eight"),
    "no name needed",
  );
  assert.ok(!add("Rahim Uddin", "not-an-email", "at-least-eight"), "bad email");
  assert.ok(
    !add("Rahim Uddin", "rahim@workshop.test", "short"),
    "short password",
  );
}

console.log("auth-check: session retirement and both forms hold");
