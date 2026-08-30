import { redirect } from "next/navigation";
import { DueBook } from "@/components/due-book/due-book";
import { getCurrentUser } from "@/lib/auth";

export default async function DashboardPage() {
  // proxy.ts already gates /dashboard; this is what makes `user` non-null here
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <DueBook user={{ name: user.name, email: user.email }} />;
}
