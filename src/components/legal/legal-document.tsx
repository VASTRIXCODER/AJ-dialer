import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";

/** Visually flags a bracketed placeholder ([MONTH DAY, YEAR], etc.) that must be
 *  replaced with a real value before this document is used as a binding agreement. */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded bg-warning/25 px-1 py-0.5 font-semibold text-warning-foreground/90 dark:text-warning">
      {children}
    </mark>
  );
}

export function LegalDocument({
  title,
  meta,
  draft,
  children,
}: {
  title: React.ReactNode;
  /** e.g. "Effective Date: … · Version …" */
  meta?: React.ReactNode;
  /** Shows a "pending / not yet finalized" banner instead of the usual layout. */
  draft?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <span className="text-sm font-bold tracking-tight">AIATWORK</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {meta && <p className="mt-2 text-sm text-muted-foreground">{meta}</p>}

        {draft ? (
          <div className="mt-8 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="text-sm text-muted-foreground">
              This document is still being finalized and is not yet published. Contact{" "}
              <Placeholder>[SUPPORT EMAIL]</Placeholder> with any questions in the meantime.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/5 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs text-muted-foreground">
                This document contains placeholder fields (highlighted) that must be completed,
                and should be reviewed by qualified counsel, before it is relied on as a binding
                agreement.
              </p>
            </div>
            <div className="prose prose-sm sm:prose-base mt-8 max-w-none space-y-5 leading-relaxed text-foreground/90 [&_h2]:mt-9 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:mt-1 [&_p]:text-sm [&_p]:text-foreground/85 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-sm">
              {children}
            </div>
          </>
        )}

        <p className="mt-14 text-xs text-muted-foreground">
          <Link href="/" className="font-semibold text-primary hover:underline">
            ← Back to AIATWORK
          </Link>
        </p>
      </main>
    </div>
  );
}
