"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

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
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </span>
          <div className="max-w-sm">
            <p className="text-lg font-semibold tracking-tight">Something went wrong</p>
            <p className="mt-1 text-sm text-gray-500">
              {process.env.NODE_ENV === "development"
                ? error.message
                : "An unexpected error occurred. Please try again."}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
