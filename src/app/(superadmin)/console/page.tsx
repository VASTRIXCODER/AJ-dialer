import { redirect } from "next/navigation";
import { SuperConsole } from "@/components/superadmin/super-console";
import { isSuperadmin } from "@/lib/superadmin";

export const metadata = { title: "Superadmin Console" };
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  if (!(await isSuperadmin())) redirect("/login");
  return <SuperConsole />;
}
