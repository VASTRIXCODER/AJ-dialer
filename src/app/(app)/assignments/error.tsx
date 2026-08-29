"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function AssignmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AssignmentsError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-4 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-danger/30 bg-danger/10">
        <AlertTriangle className="h-7 w-7 text-danger" />
      </span>
      <div className="max-w-sm">
        <p className="text-lg font-semibold tracking-tight">
          Couldn&rsquo;t load assignments
        </p>
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
  );
}
