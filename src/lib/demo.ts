// ─────────────────────────────────────────────────────────────────────────────
// Demo-data toggle.
//
// OFF by default → the app ships PRODUCTION-CLEAN with no placeholder data.
// Every screen renders real (initially empty) states until you connect your
// data sources in src/lib/queries/* (and src/lib/db/leads.ts for the dialer).
//
// Set NEXT_PUBLIC_DEMO_DATA=true in .env.local to preview every screen populated
// with realistic sample data (useful for demos and screenshots).
// ─────────────────────────────────────────────────────────────────────────────

export const DEMO_DATA = process.env.NEXT_PUBLIC_DEMO_DATA === "true";
