import { LogOut, ShieldAlert, Wrench } from "lucide-react";
import { LogoMark } from "@/components/brand/logo";
import { AmbientBackground } from "@/components/layout/ambient-background";

/**
 * Full-screen lockout shown to everyone except the superadmin when the app is
 * shut down, or to a single suspended account. No nav, no data — just a message
 * and a way to sign out.
 */
export function MaintenanceScreen({
  message,
  suspended = false,
}: {
  message?: string;
  suspended?: boolean;
}) {
  const Icon = suspended ? ShieldAlert : Wrench;
  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <AmbientBackground />
      <div className="surface-glass animate-fade-up w-full max-w-md rounded-2xl border border-border/60 p-8 text-center shadow-lift">
        <LogoMark className="mx-auto h-11 w-11" />
        <div className="mx-auto mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-warning">
          <Icon className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight">
          {suspended ? "Account suspended" : "We'll be right back"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {suspended
            ? "Your access has been paused by an administrator. Contact your administrator if you think this is a mistake."
            : message || "The dialer is temporarily unavailable for maintenance. Please check back shortly."}
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
