"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useState } from "react";
import { CommandPalette } from "@/components/ai/command-palette";
import { type DialerConfig, DialerProvider } from "@/components/dialer/dialer-context";
import { GlobalCallBar } from "@/components/dialer/global-call-bar";
import { Lead360Provider } from "@/components/leads/lead-360/lead-360-provider";
import { orgAccentCss } from "@/lib/org/accent";
import type { OrgFeatures } from "@/lib/org/settings";
import { DEFAULT_VOCABULARY, type OrgVocabulary } from "@/lib/org/vocabulary";
import { AmbientBackground } from "./ambient-background";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { Permission } from "@/lib/permissions";
import { PermissionsProvider } from "./permissions";
import { VocabularyProvider } from "./vocabulary";

type Account = { name: string; email: string; initials: string };

export function AppShell({
  children,
  voiceConfigured,
  aiConfigured,
  account,
  permissions = [],
  features = null,
  orgName = null,
  productName = null,
  brandColor = null,
  accentColor = null,
  logoUrl = null,
  role = null,
  superadmin = false,
  vocabulary = DEFAULT_VOCABULARY,
  dialerConfig,
}: {
  children: React.ReactNode;
  voiceConfigured: boolean;
  aiConfigured: boolean;
  account: Account | null;
  permissions?: string[];
  features?: OrgFeatures | null;
  orgName?: string | null;
  productName?: string | null;
  brandColor?: string | null;
  /** Org accent (Admin → Identity) — recolors the accent token family. */
  accentColor?: string | null;
  /** Org logo (Admin → Identity) — shown on the sidebar identity tile. */
  logoUrl?: string | null;
  role?: string | null;
  superadmin?: boolean;
  /** The org's own nouns, resolved server-side. See useVocabulary(). */
  vocabulary?: OrgVocabulary;
  /** Config for the app-wide dialer engine (persists calls across navigation). */
  dialerConfig: DialerConfig;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarProps = {
    permissions,
    features,
    orgName,
    productName,
    brandColor,
    logoUrl,
    role,
    superadmin,
    vocabulary,
  };
  // Org accent override (Admin → Identity → Accent color): a scoped stylesheet
  // that retunes the accent token family for both themes. "" = default accent.
  const accentCss = orgAccentCss(accentColor);

  return (
    <VocabularyProvider value={vocabulary}>
    {/* Outside Lead 360 so the drawer's sections can ask what the viewer may
        do without every host threading a prop down to them. Display only —
        every route re-checks server-side. */}
    <PermissionsProvider value={permissions as Permission[]}>
    <DialerProvider config={dialerConfig}>
    {/* Inside Vocabulary + Dialer so the Lead 360 drawer reads the org's nouns
        and can be opened mid-call from any dialer surface without a remount. */}
    <Lead360Provider>
    {accentCss ? <style dangerouslySetInnerHTML={{ __html: accentCss }} /> : null}
    <div className="relative flex min-h-screen" {...(accentCss ? { "data-org-accent": "" } : {})}>
      <AmbientBackground />
      <CommandPalette />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[268px] lg:block">
        <Sidebar account={account} {...sidebarProps} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-md lg:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className="fixed inset-y-0 left-0 z-50 w-[284px] lg:hidden"
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
              <Sidebar
                account={account}
                {...sidebarProps}
                onNavigate={() => setMobileOpen(false)}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[268px]">
        <Topbar
          onMenuClick={() => setMobileOpen(true)}
          voiceConfigured={voiceConfigured}
          aiConfigured={aiConfigured}
        />
        <main className="flex-1">{children}</main>
      </div>

      {/* Follows the rep to every page so an in-progress call never drops. */}
      <GlobalCallBar />
    </div>
    </Lead360Provider>
    </DialerProvider>
    </PermissionsProvider>
    </VocabularyProvider>
  );
}
