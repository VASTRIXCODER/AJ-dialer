import { redirect } from "next/navigation";
import { SuperConsole } from "@/components/superadmin/super-console";
import { isSuperadmin } from "@/lib/superadmin";

export const metadata = { title: "Superadmin Console" };
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  // Identity-based: only a real platform superadmin gets in. Everyone else who's
  // signed in goes back to the Hub (middleware already bounced signed-out users).
  if (!(await isSuperadmin())) redirect("/hub");
  return <SuperConsole />;
}
