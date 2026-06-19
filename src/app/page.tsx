import {
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  Headphones,
  Layers,
  PhoneCall,
  Radio,
  Recycle,
  Sparkles,
  Sun,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { AmbientBackground } from "@/components/layout/ambient-background";
import { DialingPreview } from "@/components/marketing/dialing-preview";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { Reveal, RevealItem, Stagger } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const stats = [
  { value: "3X", label: "More conversations per hour" },
  { value: "+42%", label: "Appointment volume" },
  { value: "<2s", label: "Connect to first answer" },
  { value: "100%", label: "Browser-based, no hardware" },
];

const features = [
  { icon: PhoneCall, title: "Browser-based dialer", desc: "Click-to-call, power, auto, and parallel dialing — straight from the browser. No desk phones." },
  { icon: Layers, title: "3X parallel dialing", desc: "Ring three homeowners at once. The first to answer connects instantly; the rest are released automatically." },
  { icon: Radio, title: "Live call monitoring", desc: "Listen in, whisper-coach, and watch every active conversation on the floor in real time." },
  { icon: Bot, title: "AI qualification agent", desc: "An always-on agent that dials, qualifies, and books account reviews — then hands them to your reps." },
  { icon: Users, title: "Smart lead distribution", desc: "Route leads by rep, team, campaign, territory, utility, or solar provider — automatically." },
  { icon: BarChart3, title: "Real-time analytics", desc: "Calls, connect rate, appointments, utility-bill insights, and leaderboards — all live." },
];

const dialerIncludes = [
  "Browser dialer & power dialing",
  "3X parallel dialing",
  "Auto dialing",
  "Call recordings",
  "Live call monitoring",
  "Leaderboards",
  "Lead & callback management",
  "Appointment scheduling",
  "Reporting dashboards",
];

const aiIncludes = [
  "Outbound AI calling",
  "Solar qualification workflow",
  "Utility-bill identification",
  "Appointment booking",
  "AI call summaries",
  "Lead scoring",
  "Automated follow-up",
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen">
      {/* Living ambient backdrop — consistent with the app shell */}
      <AmbientBackground />

      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-solar opacity-[0.18] blur-[120px]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="animate-fade-up">
            <Badge tone="primary" className="gap-1.5">
              <Sun className="h-3.5 w-3.5" />
              Solar Resolution Dialer
            </Badge>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Find homeowners{" "}
              <span className="text-gradient-solar">overpaying</span> on solar &
              utility bills.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              An Apple-grade, Twilio-powered outbound platform built for solar
              teams. Dial three lines at once, qualify with AI, and book account
              reviews — all from the browser.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/dialer"
                className={buttonVariants({ size: "lg", className: "gap-2" })}
              >
                <PhoneCall className="h-5 w-5" />
                Open the dialer
              </Link>
              <Link
                href="/dashboard"
                className={buttonVariants({
                  size: "lg",
                  variant: "outline",
                  className: "gap-2",
                })}
              >
                View dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Runs in full demo mode out of the box — add Twilio keys to go live.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <DialingPreview />
          </div>
        </div>

        {/* Stats band */}
        <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <div className="grid grid-cols-2 gap-4 rounded-3xl border border-border bg-card/60 p-6 backdrop-blur sm:p-8 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-3xl font-black tracking-tight text-gradient-solar sm:text-4xl">
                  {s.value}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="platform" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Badge tone="accent">One platform</Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Everything your floor needs to scale outbound
          </h2>
          <p className="mt-3 text-muted-foreground">
            High-volume dialing, live management, scheduling, and AI
            qualification — unified in one beautifully simple system.
          </p>
        </Reveal>

        <Stagger className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <RevealItem key={f.title}>
              <Card className="group h-full p-6 hover-lift sheen">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110">
                  <f.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            </RevealItem>
          ))}
        </Stagger>
      </section>

      {/* Parallel dialing */}
      <section id="parallel" className="border-y border-border bg-surface-muted/50">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <Reveal>
            <Badge tone="primary" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              3X Parallel Dialing
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Stop waiting on dial tones
            </h2>
            <p className="mt-3 text-muted-foreground">
              Instead of calling one lead at a time, the system rings up to three
              homeowners simultaneously. The moment someone picks up, your rep is
              connected and the other lines are released.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "More conversations per hour",
                "Less time on unanswered calls",
                "Higher rep productivity & appointment volume",
              ].map((b) => (
                <li key={b} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-success">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-medium">{b}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center gap-4">
              {["Lead A", "Lead B", "Lead C"].map((l, i) => (
                <div key={l} className="flex items-center gap-4">
                  <div
                    className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                      i === 0
                        ? "border-success/40 bg-success/10 text-success"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {l}
                    {i === 0 && " ✓"}
                  </div>
                  {i < 2 && <span className="text-muted-foreground">+</span>}
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.1} className="flex justify-center">
            <DialingPreview />
          </Reveal>
        </div>
      </section>

      {/* AI agent */}
      <section id="ai" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal>
          <Card className="relative overflow-hidden border-0 bg-solar p-8 text-white shadow-glow sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 left-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="relative grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Optional AI add-on
              </span>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Let AI handle qualification
              </h2>
              <p className="mt-3 max-w-lg text-white/80">
                The Solar Resolution AI Agent makes outbound calls, asks
                qualification questions, identifies utility-bill issues, books
                appointments, and writes summaries — so your reps only talk to
                warm, qualified homeowners.
              </p>
              <Link
                href="/ai-agent"
                className={buttonVariants({
                  size: "lg",
                  variant: "secondary",
                  className: "mt-7 gap-2",
                })}
              >
                <Bot className="h-5 w-5" />
                Explore the AI agent
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: PhoneCall, label: "Outbound calling" },
                { icon: Zap, label: "Bill identification" },
                { icon: Headphones, label: "Books appointments" },
                { icon: Recycle, label: "Automated follow-up" },
              ].map((it) => (
                <div
                  key={it.label}
                  className="rounded-2xl bg-white/10 p-5 ring-1 ring-inset ring-white/15 backdrop-blur"
                >
                  <it.icon className="h-6 w-6" />
                  <p className="mt-3 text-sm font-semibold">{it.label}</p>
                </div>
              ))}
            </div>
          </div>
          </Card>
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border bg-surface-muted/50">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Badge tone="primary">Pricing</Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Simple, scale-friendly pricing
            </h2>
            <p className="mt-3 text-muted-foreground">
              Pay for active reps. Add the AI agent whenever you’re ready.
            </p>
          </Reveal>

          <Reveal className="mt-12 grid gap-6 lg:grid-cols-2">
            <Card className="flex flex-col p-8">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <PhoneCall className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">Dialer Platform</h3>
              </div>
              <div className="mt-6">
                <span className="text-4xl font-black tracking-tight">$15</span>
                <span className="text-muted-foreground">
                  {" "}
                  / active rep / month
                </span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {dialerIncludes.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className={buttonVariants({ className: "mt-8 w-full" })}
              >
                Get started
              </Link>
            </Card>

            <Card className="relative flex flex-col overflow-hidden p-8 ring-2 ring-primary">
              <span className="absolute right-6 top-6">
                <Badge tone="primary" className="gap-1">
                  <Sparkles className="h-3 w-3" />
                  Add-on
                </Badge>
              </span>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-solar text-white">
                  <Bot className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold">Solar Resolution AI</h3>
              </div>
              <div className="mt-6">
                <span className="text-4xl font-black tracking-tight">$175</span>
                <span className="text-muted-foreground"> / month + usage</span>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {aiIncludes.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-success" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/ai-agent"
                className={buttonVariants({ className: "mt-8 w-full gap-2" })}
              >
                <Sparkles className="h-4 w-4" />
                Add AI agent
              </Link>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-solar px-6 py-16 text-center text-white shadow-glow sm:px-12">
          <div className="pointer-events-none absolute inset-0 bg-dots opacity-20" />
          <div className="relative mx-auto max-w-2xl">
            <Trophy className="mx-auto h-10 w-10" />
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Recover at-risk solar customers — before they churn
            </h2>
            <p className="mt-3 text-white/85">
              Proactively reach homeowners with utility-bill issues and connect
              them with the right account manager.
            </p>
            <Link
              href="/dashboard"
              className={buttonVariants({
                size: "lg",
                variant: "secondary",
                className: "mt-8 gap-2",
              })}
            >
              Launch the platform
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8" />
            <div className="leading-none">
              <p className="text-sm font-bold">AIATWORK</p>
              <p className="text-xs text-muted-foreground">Solar Resolution Dialer</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} AIATWORK. Powered by Twilio.
          </p>
        </div>
      </footer>
    </div>
  );
}
