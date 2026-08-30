"use client";

import { useState } from "react";
import { addWorkshopUser, changePassword } from "@/actions/auth.action";
import { LogoutButton } from "@/components/auth/logout-button";
import type { WorkshopUser } from "@/lib/auth";

export interface AccountUser {
  name: string;
  email: string;
  role: "manager" | "staff";
  caseId: string;
  createdAt: Date;
}

const day = (d: Date | string) =>
  typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Who you are, and — if you run the place — who else can get in.
 *
 * `staff` arrives from the server component and is null for anyone who is not a
 * manager, so the list is absent rather than hidden with CSS. The actions check
 * the role again on the server; this only decides what is worth rendering.
 */
export function Account({
  user,
  staff: initialStaff,
}: {
  user: AccountUser;
  staff: WorkshopUser[] | null;
}) {
  const [staff, setStaff] = useState(initialStaff ?? []);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwPending, setPwPending] = useState(false);
  const [pwFlash, setPwFlash] = useState<{
    bad?: boolean;
    text: string;
  } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [addFlash, setAddFlash] = useState<{
    bad?: boolean;
    text: string;
  } | null>(null);

  const mismatch = confirm !== "" && next !== confirm;
  const pwReady = current !== "" && next.length >= 8 && !mismatch;
  const addReady =
    name.trim() !== "" && email.trim() !== "" && password.length >= 8;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setPwPending(true);
    setPwFlash(null);
    const res = await changePassword({
      currentPassword: current,
      newPassword: next,
    });
    setPwPending(false);
    if (!res.success) {
      setPwFlash({ bad: true, text: res.error });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setPwFlash({
      text: "Password changed. Any other browser signed in as you has been signed out.",
    });
  }

  async function submitUser(e: React.FormEvent) {
    e.preventDefault();
    setAddPending(true);
    setAddFlash(null);
    const res = await addWorkshopUser({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    setAddPending(false);
    if (!res.success) {
      setAddFlash({ bad: true, text: res.error });
      return;
    }
    setStaff(res.data);
    setAddFlash({
      text: `${name.trim()} can sign in with ${email.trim().toLowerCase()} and the password you just set. Ask them to change it.`,
    });
    setName("");
    setEmail("");
    setPassword("");
  }

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="k">Signed in as</div>
          <div className="v" style={{ fontSize: 17 }}>
            {user.name}
          </div>
          <div className="n">{user.email}</div>
        </div>
        <div className="tile">
          <div className="k">Role</div>
          <div className="v" style={{ fontSize: 17 }}>
            {user.role === "manager" ? "Manager" : "Staff"}
          </div>
          <div className="n">
            {user.role === "manager"
              ? "can put colleagues on the books"
              : "can read and work the book"}
          </div>
        </div>
        <div className="tile">
          <div className="k">Workshop</div>
          <div className="v" style={{ fontSize: 17 }}>
            {user.caseId}
          </div>
          <div className="n">the one book this account works out of</div>
        </div>
        <div className="tile">
          <div className="k">Account opened</div>
          <div className="v" style={{ fontSize: 17 }}>
            {day(user.createdAt)}
          </div>
          <div className="n">{staff.length || 1} on this workshop</div>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-hd">
            <h2>Change password</h2>
            <span className="note">at least 8 characters</span>
          </div>
          <div className="panel-bd">
            {pwFlash && (
              <output
                className={`flash ${pwFlash.bad ? "bad" : ""}`}
                style={{ marginBottom: 14, display: "block" }}
              >
                {pwFlash.text}
              </output>
            )}
            <form className="form" onSubmit={submitPassword}>
              <div className="field">
                <span className="eyebrow">Current password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
              <div className="field">
                <span className="eyebrow">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </div>
              <div className="field">
                <span className="eyebrow">New password again</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                {mismatch && (
                  <span
                    style={{ fontSize: 12, color: "var(--crit-ink, #b42318)" }}
                  >
                    the two do not match
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!pwReady || pwPending}
                >
                  {pwPending ? "Changing…" : "Change password"}
                </button>
                <LogoutButton />
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>
                Changing it signs out every other browser holding this account —
                including anyone who was told the password when the account was
                opened. This one stays signed in.
              </p>
            </form>
          </div>
        </div>

        {initialStaff && (
          <div className="panel">
            <div className="panel-hd">
              <h2>Who can get in</h2>
              <span className="note">
                {staff.length} on {user.caseId}
              </span>
            </div>
            <div className="panel-bd">
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <b>{s.name}</b>
                        </td>
                        <td>{s.email}</td>
                        <td>
                          <span className="rulepill">
                            {s.role === "manager" ? "manager" : "staff"}
                          </span>
                        </td>
                        <td className="num">{day(s.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {addFlash && (
                <output
                  className={`flash ${addFlash.bad ? "bad" : ""}`}
                  style={{ margin: "14px 0", display: "block" }}
                >
                  {addFlash.text}
                </output>
              )}

              <form
                className="form"
                onSubmit={submitUser}
                style={{ marginTop: 14 }}
              >
                <span className="eyebrow">Add someone to this workshop</span>
                <div className="field">
                  <span className="eyebrow">Name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Rahim Uddin"
                  />
                </div>
                <div className="field">
                  <span className="eyebrow">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="rahim@workshop.test"
                  />
                </div>
                <div className="field">
                  <span className="eyebrow">Starting password</span>
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="at least 8 characters"
                    autoComplete="off"
                  />
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                    Shown, not hidden — you have to read it out to them. They
                    can change it from this page, which locks you out of their
                    account.
                  </span>
                </div>
                <div>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={!addReady || addPending}
                  >
                    {addPending ? "Adding…" : "Add to the workshop"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
