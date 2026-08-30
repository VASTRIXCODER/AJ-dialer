"use client";

import { useEffect } from "react";

/**
 * The last boundary. This one REPLACES the document, so it is the only file in
 * the app allowed to render its own <html> and <body>.
 *
 * There wasn't one. app/error.tsx only catches errors thrown by the root
 * layout's CHILDREN — an error thrown in the root layout itself (a bad font
 * load, a throwing provider, a broken env read at module scope) had nothing to
 * catch it, and the user got the browser's blank white failure page.
 *
 * Deliberately styled with INLINE styles and no imports beyond React. Whatever
 * broke may well be the stylesheet or the theme provider, and a fallback that
 * depends on the thing that just failed is not a fallback. It renders legibly
 * in both colour schemes without a single class name.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          background: "#0b1220",
          color: "#e8eef7",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: "26rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            The app failed to start
          </p>
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: "#9aa8bd",
            }}
          >
            Something went wrong before the page could render. Reloading usually clears it.
          </p>
          {error.digest && (
            <p style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "#6b7a90" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#fff",
              background: "#2563eb",
              border: "none",
              borderRadius: "0.75rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
