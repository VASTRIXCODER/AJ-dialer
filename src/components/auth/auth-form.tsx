"use client";

import { AlertTriangle, Loader2, LogIn, Mail, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const isLogin = mode === "login";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    // Secret superadmin path — checked server-side. A 401 just means "not the
    // superadmin", so we fall through to normal Supabase auth.
    if (isLogin) {
      try {
        const res = await fetch("/api/superadmin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: email, password }),
        });
        if (res.ok) {
          // Superadmins land in the standalone reddish console — never the app.
          window.location.href = "/console";
          return;
        }
      } catch {
        /* fall through to Supabase */
      }
    }

    if (!configured) {
      setError("Supabase isn’t configured yet — add your keys to enable accounts.");
      setLoading(false);
      return;
    }
    const supabase = createClient();
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(error.message);
          return;
        }
        const redirect =
          new URLSearchParams(window.location.search).get("redirect") || "/dashboard";
        router.push(redirect);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) {
          setError(error.message);
          return;
        }
        if (data.session) {
          router.push("/dashboard");
          router.refresh();
        } else {
          setNotice("Check your email to confirm your account, then sign in.");
        }
      }
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
        <h1 className="mt-4 text-xl font-bold tracking-tight">
          {isLogin ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isLogin
            ? "Sign in to your AIATWORK dialer."
            : "Start dialing with AI in minutes."}
        </p>
      </div>

      {!configured && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Supabase isn’t connected. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY to enable accounts.
        </div>
      )}

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
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && <p className="text-sm font-medium text-danger">{error}</p>}
        {notice && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-success">
            <Mail className="h-4 w-4" />
            {notice}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full gap-2" disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isLogin ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {isLogin ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        {isLogin ? "New here? " : "Already have an account? "}
        <Link
          href={isLogin ? "/signup" : "/login"}
          className="font-semibold text-primary hover:underline"
        >
          {isLogin ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </div>
  );
}
