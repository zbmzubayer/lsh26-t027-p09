import { redirect } from "next/navigation";
import { DueBook } from "@/components/due-book/due-book";
import { getCurrentUser, listWorkshopUsers } from "@/lib/auth";

export default async function DashboardPage() {
  // proxy.ts already gates /dashboard; this is what makes `user` non-null here
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // One account works out of one workshop. Without one there is no book to
  // show, and defaulting into someone else's would be worse than saying so.
  if (!user.caseId)
    return (
      <div className="duebook">
        <main className="shell" style={{ paddingTop: 48, maxWidth: 620 }}>
          <div className="panel">
            <div className="panel-hd">
              <h2>No workshop assigned</h2>
            </div>
            <div className="panel-bd">
              <p style={{ color: "var(--ink-2)", fontSize: 13 }}>
                {user.email} is not attached to a workshop yet, so there is no
                service register to open. An administrator has to set this
                account&apos;s workshop before the call list can be built.
              </p>
            </div>
          </div>
        </main>
      </div>
    );

  // Loaded here rather than in the client: a manager gets the list, everyone
  // else gets null and the panel does not render at all. The action checks the
  // role again on the server — this only decides what is worth sending.
  const staff =
    user.role === "manager" ? await listWorkshopUsers(user.caseId) : null;

  return (
    <DueBook
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        caseId: user.caseId,
        createdAt: user.createdAt,
      }}
      staff={staff}
      caseId={user.caseId}
    />
  );
}
