"use client";

import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  MessageSquare,
  RefreshCw,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn, formatPhone } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Messaging readiness.
//
// Every line here is CHECKED when the panel loads, not stored. That distinction
// is the whole point: the reason inbound SMS has never once reached this
// product is that each number's Messaging webhook points at ElevenLabs, and a
// stored checkbox reading "webhook configured" would have been ticked
// throughout. A line that says where the messages actually go cannot lie the
// same way.
// ─────────────────────────────────────────────────────────────────────────────

type CheckState = "ok" | "warn" | "fail" | "unknown";

interface ReadinessCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  action?: string;
}
interface NumberReadiness {
  phoneNumber: string;
  friendlyName: string;
  smsCapable: boolean;
  smsUrl: string;
  pointsHere: boolean;
  otherEnvironment?: boolean;
  notOnAccount?: boolean;
}
interface Payload {
  checks: ReadinessCheck[];
  numbers: NumberReadiness[];
  ready: boolean;
  providerError: string | null;
  expectedWebhook: string;
}

const ICON: Record<CheckState, typeof CheckCircle2> = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
  unknown: HelpCircle,
};
const TONE: Record<CheckState, string> = {
  ok: "text-success",
  warn: "text-warning",
  fail: "text-danger",
  unknown: "text-muted-foreground",
};

export function MessagingReadiness({ canFix }: { canFix: boolean }) {
  const { toast } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "error">("loading");
  const [fixing, setFixing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch("/api/messaging/readiness", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Payload);
      setState("idle");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function repoint(phoneNumber: string) {
    setFixing(phoneNumber);
    try {
      const res = await fetch("/api/messaging/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ title: j.error ?? "Twilio refused the change.", tone: "danger" });
        return;
      }
      toast({
        title: "Webhook repointed",
        description: "Replies to this number will now reach the app, including STOP.",
        tone: "success",
      });
      // Re-check rather than assume: the value of this panel is that it asks.
      await load();
    } catch {
      toast({ title: "Couldn't reach Twilio.", tone: "danger" });
    } finally {
      setFixing(null);
    }
  }

  if (state === "loading" && !data) {
    return (
      <SectionCard title="Messaging readiness" description="Checking against Twilio…">
        <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Asking Twilio what is actually configured…
        </p>
      </SectionCard>
    );
  }

  if (state === "error" || !data) {
    return (
      <SectionCard title="Messaging readiness" description="Could not run the checks.">
        <p className="text-sm text-muted-foreground">
          The readiness check itself failed, so nothing here is known either way.
        </p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
        </Button>
      </SectionCard>
    );
  }

  const failing = data.checks.filter((c) => c.state === "fail").length;

  return (
    <SectionCard
      title="Messaging readiness"
      description="Checked against Twilio just now — not stored, and not a checklist anyone ticks."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={data.ready ? "success" : "danger"}>
          {data.ready ? "Ready to send" : `${failing} blocking ${failing === 1 ? "problem" : "problems"}`}
        </Badge>
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", state === "loading" && "animate-spin")} />
          Re-check
        </Button>
      </div>

      <ul className="space-y-2">
        {data.checks.map((c) => {
          const Icon = ICON[c.state];
          return (
            <li key={c.id} className="flex items-start gap-2.5 text-sm">
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", TONE[c.state])} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{c.label}</span>
                <span className="block text-muted-foreground">{c.detail}</span>
                {c.action && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">→ {c.action}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {data.numbers.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            This workspace's numbers
          </p>
          <ul className="mt-2 space-y-2">
            {data.numbers.map((n) => (
              <li
                key={n.phoneNumber}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card p-2.5 text-sm"
              >
                <span className="font-medium tabular">{formatPhone(n.phoneNumber)}</span>
                {n.notOnAccount ? (
                  <Badge tone="danger">Not on this Twilio account</Badge>
                ) : (
                  <>
                    <Badge tone={n.smsCapable ? "success" : "neutral"}>
                      {n.smsCapable ? "SMS capable" : "Voice only"}
                    </Badge>
                    {n.smsCapable && (
                      <Badge
                        tone={n.pointsHere ? "success" : n.otherEnvironment ? "warning" : "danger"}
                      >
                        {n.pointsHere
                          ? "Replies reach us"
                          : n.otherEnvironment
                            ? "Replies reach another environment"
                            : "Replies go elsewhere"}
                      </Badge>
                    )}
                  </>
                )}
                {/* Where they ACTUALLY go. This one line is the whole panel. */}
                {n.smsCapable && !n.pointsHere && (
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {n.smsUrl ? `Currently: ${n.smsUrl}` : "No messaging webhook set at all."}
                  </span>
                )}
                {n.smsCapable && !n.pointsHere && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canFix || fixing === n.phoneNumber}
                    title={canFix ? undefined : "You need organization-edit permission."}
                    onClick={() => void repoint(n.phoneNumber)}
                  >
                    {fixing === n.phoneNumber ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wrench className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Point it here
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Inbound messages should arrive at{" "}
              <code className="tabular">{data.expectedWebhook}</code>. Repointing changes the
              Messaging webhook only — the Voice webhook is left alone, because for these numbers
              it targets the AI agent on purpose.
            </span>
          </p>
        </>
      )}
    </SectionCard>
  );
}
