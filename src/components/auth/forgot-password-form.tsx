"use client";

import { AlertTriangle, ArrowLeft, Loader2, Mail, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function ForgotPasswordForm() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!configured) {
      setError("Supabase isn’t configured yet — add your keys to enable accounts.");
      return;
    }
    setLoading(true);
    setError("");
    const supabase = createClient();
    try {
      // Lands back through the same code-exchange route OAuth/signup already use,
      // just pointed at /reset-password once the session is established.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
      });
      // Supabase deliberately doesn't report "no account with that email" — doing
      // so would let anyone probe which emails have accounts. Show the same
      // "check your email" success either way; only a real failure (rate limit,
      // network) surfaces as an error.
      if (error) {
        setError(error.message);
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="surface-glass animate-fade-up rounded-2xl border border-border/60 p-6 shadow-lift sm:p-8">
      <div className="flex flex-col items-center text-center">
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-4 text-xl font-bold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {sent
            ? "Check your inbox for a reset link."
            : "Enter your email and we'll send you a reset link."}
        </p>
      </div>

      {!configured && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Supabase isn’t connected. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to enable accounts.
        </div>
      )}

      {sent ? (
        <div className="mt-6 flex flex-col items-center gap-4 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
            <Mail className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-semibold text-foreground">{email}</span>,
            a password reset link is on its way. It expires shortly, so use it soon.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSent(false)}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>

          {error && <p className="text-sm font-medium text-danger">{error}</p>}

          <Button type="submit" size="lg" className="w-full gap-2" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send reset link
          </Button>
        </form>
      )}

      <Link
        href="/login"
        className="mt-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sign in
      </Link>
    </div>
  );
}
