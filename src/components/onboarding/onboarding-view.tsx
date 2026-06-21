"use client";

import {
  AlertTriangle,
  Building2,
  Clock,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DIALER_TEMPLATES } from "@/lib/org/templates";
import { cn } from "@/lib/utils";

type Pending = { orgName: string; requireApproval: boolean };

export function OnboardingView({
  name,
  pending,
}: {
  name: string;
  pending: Pending | null;
}) {
  const router = useRouter();
  const [pendingOrg, setPendingOrg] = useState<Pending | null>(pending);
  const [mode, setMode] = useState<"join" | "create">("join");

  if (pendingOrg) {
    return <PendingScreen org={pendingOrg} onRecheck={() => router.refresh()} />;
  }

  return (
    <div className="surface-glass animate-fade-up rounded-2xl border border-border/60 p-6 shadow-lift sm:p-8">
      <div className="flex flex-col items-center text-center">
        <LogoMark className="h-11 w-11" />
        <h1 className="mt-4 text-xl font-bold tracking-tight">
          Welcome, {name.split(" ")[0]}
        </h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Join your team’s organization with a code, or create a new one to start
          dialing with AI.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
        {(["join", "create"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition-colors",
              mode === m
                ? "bg-background text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "join" ? (
              <KeyRound className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {m === "join" ? "Join with code" : "Create one"}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {mode === "join" ? (
          <JoinForm
            onActive={() => {
              router.push("/dashboard");
              router.refresh();
            }}
            onPending={(orgName) =>
              setPendingOrg({ orgName, requireApproval: true })
            }
          />
        ) : (
          <CreateForm
            onCreated={() => {
              router.push("/dashboard");
              router.refresh();
            }}
          />
        )}
      </div>

      <SignOut />
    </div>
  );
}

function JoinForm({
  onActive,
  onPending,
}: {
  onActive: () => void;
  onPending: (orgName: string) => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/org/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not join.");
        return;
      }
      if (j.status === "active") onActive();
      else onPending(j.orgName ?? "the organization");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="code">Join code</Label>
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. SUNRUN1"
          autoCapitalize="characters"
          className="text-center text-lg font-bold uppercase tracking-[0.3em]"
          maxLength={12}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Ask your manager for your organization’s join code.
        </p>
      </div>
      {err && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" />
          {err}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full gap-2" disabled={busy || !code.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Request to join
      </Button>
    </form>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [template, setTemplate] = useState("general");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/org/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, industry, template }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not create organization.");
        return;
      }
      onCreated();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="org-name">Organization name</Label>
        <Input
          id="org-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Tesla Energy"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="industry">Industry (optional)</Label>
          <Input
            id="industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="Residential Solar"
          />
        </div>
        <div>
          <Label htmlFor="template">Specialization</Label>
          <Select
            id="template"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {DIALER_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <p className="flex items-center gap-1.5 rounded-lg bg-primary-soft/50 px-3 py-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
        You’ll be the owner — invite your team with the join code afterward.
      </p>
      {err && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" />
          {err}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full gap-2" disabled={busy || !name.trim()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
        Create organization
      </Button>
    </form>
  );
}

function PendingScreen({ org, onRecheck }: { org: Pending; onRecheck: () => void }) {
  return (
    <div className="surface-glass animate-fade-up rounded-2xl border border-border/60 p-8 text-center shadow-lift">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/15 text-warning">
        <Clock className="h-7 w-7" />
      </span>
      <h1 className="mt-4 text-xl font-bold tracking-tight">Request sent</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Your request to join <span className="font-semibold text-foreground">{org.orgName}</span>{" "}
        is awaiting approval from a manager. You’ll get in as soon as they approve
        you.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={onRecheck} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Check again
        </Button>
      </div>
      <SignOut />
    </div>
  );
}

function SignOut() {
  return (
    <form action="/auth/signout" method="post" className="mt-5 text-center">
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </form>
  );
}
