"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/**
 * The boundary for the root layout's CHILDREN.
 *
 * It used to return its own `<html>` and `<body>`. Only global-error.tsx may do
 * that — this file renders INSIDE the root layout, so the parser met a second
 * <body> start tag and, per the "in body" insertion mode, created no element
 * and merged over only attributes the real body did not already have. The real
 * body already carries a class, so every layout class here — the centering, the
 * min-height, the padding — was dropped on the floor, and the error screen
 * rendered top-left in normal flow. (The theme and font were never at risk:
 * both are inherited from ancestors that this boundary sits inside.)
 *
 * A plain wrapper, like the sibling boundary at (app)/error.tsx already used.
 * Tokens rather than raw palette for the same reason every other surface uses
 * them: `text-gray-500` is fixed, while `--muted-foreground` brightens in dark
 * mode, which is this app's default.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[RootError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10">
          <AlertTriangle className="h-7 w-7 text-danger" />
        </span>
        <div className="max-w-sm">
          <p className="text-lg font-semibold tracking-tight">Something went wrong</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {process.env.NODE_ENV === "development"
              ? error.message
              : "An unexpected error occurred. Please try again."}
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-soft transition-opacity hover:opacity-90"
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
