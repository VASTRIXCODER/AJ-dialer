"use client";

import { AlertTriangle, CheckCircle2, Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function InviteTeammate() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) setMsg({ ok: false, text: j.error ?? "Invite failed." });
      else {
        setMsg({ ok: true, text: `Invite sent to ${email}.` });
        setEmail("");
      }
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={invite} className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" size="sm" className="gap-2" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          Invite
        </Button>
      </div>
      {msg && (
        <span
          className={cn(
            "flex items-center gap-1.5 text-xs",
            msg.ok ? "text-success" : "text-danger",
          )}
        >
          {msg.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          {msg.text}
        </span>
      )}
    </form>
  );
}
