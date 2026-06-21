import { redirect } from "next/navigation";
import { OnboardingView } from "@/components/onboarding/onboarding-view";
import { getPendingMembership, getViewer } from "@/lib/org/membership";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join an organization" };

export default async function OnboardingPage() {
  if (await isSuperadmin()) redirect("/console");

  const viewer = await getViewer();
  if (viewer.isDemo) redirect("/dashboard"); // demo already belongs to an org
  if (!viewer.user) redirect("/login");
  if (viewer.org) redirect("/dashboard"); // already an active member

  const pending = await getPendingMembership(viewer.user.id);

  return (
    <OnboardingView
      name={viewer.displayName}
      pending={
        pending
          ? {
              orgName: pending.org?.name ?? "the organization",
              requireApproval: pending.org?.requireApproval ?? true,
            }
          : null
      }
    />
  );
}
