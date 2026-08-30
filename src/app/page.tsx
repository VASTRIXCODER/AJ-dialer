import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  Car,
  Check,
  Contact,
  FileText,
  HeartPulse,
  Landmark,
  Layers,
  ListChecks,
  Megaphone,
  Mic,
  Music,
  PhoneCall,
  PhoneOutgoing,
  Radio,
  RadioTower,
  Repeat,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Trophy,
  Upload,
  UsersRound,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { AmbientBackground } from "@/components/layout/ambient-background";
import { LeaderboardPreview } from "@/components/marketing/leaderboard-preview";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { SalesDashboard } from "@/components/marketing/sales-dashboard";
import { Reveal, RevealItem, Stagger } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const features = [
  { icon: Layers, title: "Multiline Power Dialing", desc: "Call multiple leads simultaneously and connect a rep the instant a live person answers." },
  { icon: Contact, title: "Built-In CRM", desc: "Track every lead, conversation, follow-up, appointment, outcome, and opportunity from one workspace." },
  { icon: Trophy, title: "Gamified Leaderboards", desc: "Live rankings for calls, conversations, appointments, sales, and team performance." },
  { icon: Radio, title: "Live Call Monitoring", desc: "See who's active, listen to live conversations, and coach reps in real time." },
  { icon: Sparkles, title: "AI Call Notes", desc: "Automatically summarize every conversation and save key details to the lead profile." },
  { icon: FileText, title: "Call Transcripts", desc: "Searchable transcripts so managers can review conversations without listening to every recording." },
  { icon: Users, title: "Lead Management", desc: "Import, organize, assign, filter, tag, prioritize, and track leads through the entire process." },
  { icon: Mic, title: "Call Recordings", desc: "Automatically record and organize calls for training, quality control, and compliance." },
  { icon: Repeat, title: "Sales Automations", desc: "Create follow-ups, update stages, send reminders, assign tasks, and trigger workflows by outcome." },
  { icon: Megaphone, title: "Campaign Management", desc: "Build campaigns, upload lists, assign reps, control dialing rules, and monitor results." },
  { icon: Music, title: "Background Music", desc: "Let reps play optional background music while dialing to keep energy and focus between calls." },
  { icon: CalendarCheck, title: "Appointments & Callbacks", desc: "Schedule appointments, create callbacks, and track upcoming follow-ups inside the platform." },
  { icon: BarChart3, title: "Real-Time Analytics", desc: "Answer rates, talk time, appointment and conversion rates, rep activity, and campaign performance." },
  { icon: UsersRound, title: "Team Management", desc: "Add reps, assign permissions, manage access, and monitor individual and team performance." },
  { icon: ListChecks, title: "Smart Dispositions", desc: "Mark outcomes fast — interested, appointment booked, follow-up, no answer, voicemail, bad number, or do not call." },
];

const workflow = [
  { icon: Upload, label: "Lead Imported" },
  { icon: PhoneOutgoing, label: "Call Attempted" },
  { icon: Mic, label: "Conversation Recorded" },
  { icon: Sparkles, label: "AI Notes Created" },
  { icon: TrendingUp, label: "Lead Status Updated" },
  { icon: CalendarCheck, label: "Follow-Up Scheduled" },
  { icon: Bell, label: "Manager Notified" },
];

const industries = [
  { icon: Wrench, label: "Home Services" },
  { icon: ShieldCheck, label: "Insurance" },
  { icon: Building2, label: "Real Estate" },
  { icon: Megaphone, label: "Marketing Agencies" },
  { icon: Car, label: "Automotive" },
  { icon: RadioTower, label: "Telecommunications" },
  { icon: Landmark, label: "Financial Services" },
  { icon: Contact, label: "Recruiting" },
  { icon: HeartPulse, label: "Healthcare" },
  { icon: Store, label: "Local Businesses" },
];

const pricingIncludes = [
  "Multiline power dialer",
  "Built-in CRM",
  "AI call notes",
  "Call transcripts",
  "Call recordings",
  "Lead management",
  "Live call monitoring",
  "Gamified leaderboard",
  "Campaign management",
  "Sales analytics",
  "Automations",
  "Appointments & callbacks",
  "Team management",
  "Human support",
];

const comparison = [
  "Power dialing",
  "CRM",
  "Call recording",
  "Call monitoring",
  "AI notes",
  "Transcripts",
  "Leaderboards",
  "Lead management",
  "Automations",
  "Analytics",
];

const managementPoints = [
  "Monitor active representatives",
  "Listen to live calls",
  "Review recordings & transcripts",
  "Compare performance side by side",
  "Spot coaching opportunities early",
  "One dashboard for the whole floor",
];

function PriceChip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft/50 px-3 py-1 text-xs font-semibold text-primary">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      Just $30 per seat / month
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className="dark relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <AmbientBackground />
      <MarketingNav />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden pt-16">
        <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[460px] w-[820px] -translate-x-1/2 rounded-full bg-brand opacity-[0.16] blur-[130px]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="animate-fade-up">
            <PriceChip />
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              More Conversations. More Appointments.{" "}
              <span className="text-gradient-brand">More Revenue.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              Give your sales team a complete power dialer, CRM, call intelligence,
              lead management, and performance platform — for only{" "}
              <span className="font-semibold text-foreground">$30 per seat</span>.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className={buttonVariants({ size: "lg", className: "gap-2" })}>
                <PhoneCall className="h-5 w-5" />
                Start Building Your Sales Team
              </Link>
              <Link
                href="/signup"
                className={buttonVariants({ size: "lg", variant: "outline", className: "gap-2" })}
              >
                Book a Live Demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Built for sales teams of every size and every industry.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <SalesDashboard />
          </div>
        </div>
      </section>

      {/* ── Core value ───────────────────────────────────────────────────── */}
      <section id="platform" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Badge tone="accent">One platform</Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Everything Your Sales Team Needs in One Platform
          </h2>
          <p className="mt-3 text-muted-foreground">
            Stop paying for separate dialers, CRMs, monitoring tools, call recording
            software, analytics platforms, and sales management systems. Run your
            entire outbound operation from one place.
          </p>
        </Reveal>

        <div id="features" className="scroll-mt-24" aria-hidden />
        <Stagger className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <RevealItem key={f.title}>
              <Card className="group h-full p-6 hover-lift">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            </RevealItem>
          ))}
        </Stagger>

        <Reveal className="mt-12 flex flex-col items-center gap-4 text-center">
          <PriceChip />
          <Link href="/signup" className={buttonVariants({ size: "lg", className: "gap-2" })}>
            Start Building Your Sales Team
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </section>

      {/* ── Automation ───────────────────────────────────────────────────── */}
      <section className="border-y border-border/60 bg-surface-muted/40">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Badge tone="primary">Automation</Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Your Sales Process Should Not Depend on Memory
            </h2>
            <p className="mt-3 text-muted-foreground">
              The platform automatically captures conversations, updates records,
              creates follow-ups, organizes leads, and keeps managers informed. Your
              reps can focus on selling instead of administrative work.
            </p>
          </Reveal>

          <Stagger className="mt-12 flex flex-wrap items-stretch justify-center gap-3">
            {workflow.map((w, i) => (
              <RevealItem key={w.label} className="flex items-center gap-3">
                <Card className="flex w-40 flex-col items-center gap-2 p-4 text-center">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <w.icon className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-semibold leading-tight">{w.label}</span>
                </Card>
                {i < workflow.length - 1 && (
                  <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground lg:block" />
                )}
              </RevealItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── Performance ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <Badge tone="accent" className="gap-1.5">
              <Trophy className="h-3.5 w-3.5" />
              Performance
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Turn Sales Into a Team Sport
            </h2>
            <p className="mt-3 text-muted-foreground">
              Live leaderboards, performance goals, call statistics, appointment
              tracking, and activity feeds help managers build a more accountable and
              competitive sales culture.
            </p>
            <Link
              href="/signup"
              className={buttonVariants({ className: "mt-7 gap-2" })}
            >
              Book a Live Demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
          <Reveal delay={0.1}>
            <LeaderboardPreview />
          </Reveal>
        </div>
      </section>

      {/* ── Management ───────────────────────────────────────────────────── */}
      <section className="border-y border-border/60 bg-surface-muted/40">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <Reveal className="order-2 lg:order-1">
            <div className="grid grid-cols-2 gap-3">
              {managementPoints.map((p) => (
                <Card key={p} className="flex items-start gap-2.5 p-4">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-sm font-medium leading-snug">{p}</span>
                </Card>
              ))}
            </div>
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <Badge tone="primary" className="gap-1.5">
              <Radio className="h-3.5 w-3.5" />
              Live management
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              See What Your Team Is Doing in Real Time
            </h2>
            <p className="mt-3 text-muted-foreground">
              Managers can monitor active representatives, listen to live calls,
              review recordings, inspect transcripts, compare performance, and
              identify coaching opportunities — all from one dashboard.
            </p>
            <Link href="/signup" className={buttonVariants({ className: "mt-7 gap-2" })}>
              Book a Live Demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ── Industries ───────────────────────────────────────────────────── */}
      <section id="industries" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Badge tone="accent">Industries</Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Built for Any Team That Sells Over the Phone
          </h2>
          <p className="mt-3 text-muted-foreground">
            One platform, endlessly configurable. Every team customizes its own
            campaigns, lead stages, outcomes, scripts, and workflows — no
            industry-specific version required.
          </p>
        </Reveal>

        <Stagger className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {industries.map((it) => (
            <RevealItem key={it.label}>
              <Card className="flex h-full flex-col items-center gap-3 p-6 text-center hover-lift">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <it.icon className="h-6 w-6" />
                </span>
                <span className="text-sm font-semibold">{it.label}</span>
              </Card>
            </RevealItem>
          ))}
        </Stagger>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-y border-border/60 bg-surface-muted/40">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Badge tone="primary">Pricing</Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
              Enterprise Sales Tools Without Enterprise Pricing
            </h2>
          </Reveal>

          <Reveal className="mt-12">
            <Card className="relative overflow-hidden p-8 ring-2 ring-primary sm:p-10">
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand opacity-20 blur-3xl" />
              <div className="relative grid gap-8 lg:grid-cols-[auto_1fr]">
                <div className="lg:border-r lg:border-border/60 lg:pr-8">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-white">
                    <PhoneCall className="h-6 w-6" />
                  </div>
                  <div className="mt-6 flex items-end gap-1.5">
                    <span className="text-5xl font-black tracking-tight">$30</span>
                    <span className="mb-1 text-muted-foreground">/ seat / month</span>
                  </div>
                  <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                    The complete platform — every feature included. Add seats as your
                    team grows.
                  </p>
                  <Link
                    href="/signup"
                    className={buttonVariants({ size: "lg", className: "mt-7 w-full gap-2" })}
                  >
                    Book Your Demo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                <ul className="grid gap-3 sm:grid-cols-2">
                  {pricingIncludes.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="h-4 w-4 shrink-0 text-success" />
                      <span className="font-medium">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="relative mt-8 rounded-xl border border-border/60 bg-surface/50 px-4 py-3 text-xs text-muted-foreground">
                Usage-based calling costs may apply depending on call volume and
                selected phone services.
              </p>
            </Card>
          </Reveal>
        </div>
      </section>

      {/* ── Comparison ───────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Badge tone="accent">One platform, not ten</Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Replace Multiple Sales Tools With One Platform
          </h2>
          <p className="mt-3 text-muted-foreground">
            Most teams stitch together a different subscription for every one of
            these. You get them all in a single platform.
          </p>
        </Reveal>

        <Reveal className="mt-12 overflow-hidden rounded-3xl border border-border/70 bg-card/70">
          <div className="grid grid-cols-[1fr_auto_auto] items-center border-b border-border/60 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:px-8">
            <span>Capability</span>
            <span className="px-4 text-center">Separate tools</span>
            <span className="pl-4 text-center text-primary">AIATWORK</span>
          </div>
          {comparison.map((c) => (
            <div
              key={c}
              className="grid grid-cols-[1fr_auto_auto] items-center border-b border-border/40 px-5 py-3.5 text-sm last:border-0 sm:px-8"
            >
              <span className="font-medium">{c}</span>
              <span className="px-4 text-center text-xs font-medium text-muted-foreground">
                Extra subscription
              </span>
              <span className="flex justify-center pl-4">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15 text-success">
                  <Check className="h-3 w-3" />
                </span>
              </span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-3 bg-primary-soft/30 px-5 py-6 text-center sm:px-8">
            <p className="text-sm text-muted-foreground">
              Everything above — one login, one bill.
            </p>
            <p className="text-2xl font-black tracking-tight">
              All included for <span className="text-gradient-brand">$30 / seat</span>
            </p>
            <Link href="/signup" className={buttonVariants({ className: "mt-1 gap-2" })}>
              Book a Live Demo
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-brand px-6 py-16 text-center text-white sm:px-12">
            <div className="pointer-events-none absolute inset-0 bg-dots opacity-20" />
            <div className="relative mx-auto max-w-2xl">
              <TrendingUp className="mx-auto h-10 w-10" />
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                Build a Faster, Smarter, More Accountable Sales Team
              </h2>
              <p className="mt-3 text-white/85">
                See how one platform helps your reps make more calls, have better
                conversations, book more appointments, and gives managers complete
                visibility.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/signup"
                  className={buttonVariants({ size: "lg", variant: "secondary", className: "gap-2" })}
                >
                  Book a Live Demo
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-7 text-base font-semibold text-white ring-1 ring-inset ring-white/40 transition-colors hover:bg-white/10"
                >
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <p className="mt-5 text-sm font-medium text-white/80">
                Just $30 per seat / month.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white">
                  <PhoneCall className="h-4 w-4" />
                </span>
                <span className="text-[15px] font-bold tracking-tight">AIATWORK</span>
              </div>
              <p className="mt-4 max-w-xs text-sm text-muted-foreground">
                The complete sales dialer, CRM, and performance platform built for
                modern outbound teams.
              </p>
              <p className="mt-4 text-sm font-semibold text-primary">$30 per seat / month</p>
            </div>

            <FooterCol
              title="Platform"
              links={[
                ["Features", "#features"],
                ["Industries", "#industries"],
                ["Pricing", "#pricing"],
              ]}
            />
            <FooterCol
              title="Company"
              links={[
                ["Support", "/login"],
                ["Contact", "/signup"],
                ["Book a Demo", "/signup"],
              ]}
            />
            <FooterCol
              title="Legal"
              links={[
                ["Privacy Policy", "/login"],
                ["Terms of Service", "/login"],
                ["Log In", "/login"],
              ]}
            />
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-6 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} AIATWORK. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">
              The complete sales platform for modern outbound teams.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link
              href={href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
