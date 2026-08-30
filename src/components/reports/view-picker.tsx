"use client";

import { Bookmark, BookmarkPlus, Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
  MAX_REPORT_VIEWS,
  reportViewHref,
  type ReportView,
  type ReportViewConfig,
} from "@/lib/reports/view-spec";

/**
 * Saved report views — name the range+compare setup you keep coming back to.
 *
 * Views live in org settings (settings.reportViews) and ride the existing
 * org-settings PATCH, so writes need `org.edit` (manager+). Viewers without it
 * can APPLY any saved view (it's just a URL) — the save/delete controls are
 * hidden for them rather than rendered dead.
 */
export function ReportViewPicker({
  views,
  current,
  canWrite,
}: {
  views: ReportView[];
  current: ReportViewConfig;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // The saved view whose config matches what's on screen right now (if any).
  const active = views.find(
    (v) => v.config.range === current.range && v.config.compare === current.compare,
  );
  const full = views.length >= MAX_REPORT_VIEWS;

  async function persist(next: ReportView[]) {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { reportViews: next } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not save the view.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setErr("Network error.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `rv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const ok = await persist([
      ...views,
      { id, name: trimmed.slice(0, 60), config: { ...current } },
    ]);
    if (ok) {
      setNaming(false);
      setName("");
    }
  }

  async function deleteActive() {
    if (!active) return;
    await persist(views.filter((v) => v.id !== active.id));
  }

  if (views.length === 0 && !canWrite) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.length > 0 && (
        <SelectMenu
          label="Saved report views"
          placeholder="Saved views…"
          size="sm"
          triggerClassName="h-9 min-w-36"
          value={active?.id ?? null}
          onChange={(id) => {
            const v = views.find((x) => x.id === id);
            if (v) router.push(reportViewHref(v.config));
          }}
          options={views.map((v) => ({ value: v.id, label: v.name }))}
        />
      )}

      {canWrite && !naming && (
        <>
          {active ? (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={busy}
              onClick={deleteActive}
              aria-label={`Delete saved view ${active.name}`}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete view
            </Button>
          ) : full ? (
            <Tooltip content={`Limit of ${MAX_REPORT_VIEWS} saved views reached — delete one first.`}>
              <span className="inline-flex">
                <Button size="sm" variant="outline" className="gap-1.5" disabled>
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  Save view
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setNaming(true)}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save view
            </Button>
          )}
        </>
      )}

      {canWrite && naming && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void saveCurrent();
          }}
        >
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this view"
            aria-label="Saved view name"
            className="h-9 w-40 text-xs"
          />
          <Button size="sm" type="submit" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            aria-label="Cancel saving view"
            onClick={() => {
              setNaming(false);
              setName("");
              setErr("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}

      {err && <span className="text-xs font-medium text-danger">{err}</span>}
    </div>
  );
}
