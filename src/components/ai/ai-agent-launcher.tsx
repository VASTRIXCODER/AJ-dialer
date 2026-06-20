"use client";

import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  PhoneOutgoing,
  Radio,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SpotlightCard } from "@/components/motion";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Hands the current lead to the ElevenLabs voice agent: it dials, runs your
 * script, records, and posts results back for Claude to summarize. Watch + take
 * over from Live Monitor.
 */
export function AiAgentLauncher({
  leadId,
  leadName,
  configured,
}: {
  leadId: string | null;
  leadName: string;
  configured: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "placing" | "placed" | "error">(
    "idle",
  );
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  async function placeCall() {
    if (!leadId) return;
    setStatus("placing");
    setMessage("");
    setConversationId(null);
    try {
      const res = await fetch("/api/elevenlabs/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(json.error ?? "Could not place the AI call.");
        return;
      }
      setStatus("placed");
      setConversationId(json.conversationId ?? null);
      setMessage(`AI agent is calling ${leadName}.`);
    } catch {
      setStatus("error");
      setMessage("Network error placing the AI call.");
    }
  }

  const firstName = leadName.split(" ")[0] || "lead";

  return (
    <SpotlightCard tilt={false} className="overflow-hidden p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              AI Voice Agent
              <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                ElevenLabs
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {configured
                ? "The agent dials, qualifies & books — Claude writes the summary."
                : "Connect ElevenLabs to let the AI conduct calls for you."}
            </p>
          </div>
        </div>

        {configured ? (
          <Button
            size="sm"
            className="shrink-0 gap-2"
            onClick={placeCall}
            disabled={!leadId || status === "placing"}
          >
            {status === "placing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PhoneOutgoing className="h-4 w-4" />
            )}
            {status === "placing" ? "Dialing…" : `Have AI call ${firstName}`}
          </Button>
        ) : (
          <Link
            href="/ai-agent"
            className={buttonVariants({
              size: "sm",
              variant: "outline",
              className: "shrink-0 gap-2",
            })}
          >
            <Sparkles className="h-4 w-4" />
            Connect agent
          </Link>
        )}
      </div>

      {message && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p
            className={cn(
              "flex items-center gap-1.5 text-xs",
              status === "error" ? "text-danger" : "text-success",
            )}
          >
            {status === "error" ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {message}
          </p>

          {status === "placed" && (
            <Link
              href={
                conversationId
                  ? `/monitor?call=${encodeURIComponent(conversationId)}`
                  : "/monitor"
              }
              className={buttonVariants({
                size: "sm",
                variant: "outline",
                className: "shrink-0 gap-1.5",
              })}
            >
              <Radio className="h-3.5 w-3.5" />
              View in Live Monitor
            </Link>
          )}
        </div>
      )}
    </SpotlightCard>
  );
}
