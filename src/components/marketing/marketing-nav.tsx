"use client";

import { Menu, PhoneCall, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { label: "Platform", href: "#platform" },
  { label: "Features", href: "#features" },
  { label: "Industries", href: "#industries" },
  { label: "Pricing", href: "#pricing" },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-solar shadow-glow">
        <PhoneCall className="h-[52%] w-[52%] text-white" />
      </span>
      <div className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight text-foreground">AIATWORK</span>
        <span className="text-[11px] font-medium text-muted-foreground">Sales Platform</span>
      </div>
    </Link>
  );
}

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled ? "border-b border-border/60 glass" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Brand />

        <nav className="hidden items-center gap-8 lg:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 sm:flex">
          <span className="mr-1 hidden items-center gap-1.5 rounded-full border border-primary/25 bg-primary-soft/50 px-2.5 py-1 text-xs font-semibold text-primary xl:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            $30 / seat / month
          </span>
          <Link
            href="/login"
            className={buttonVariants({ size: "sm", variant: "ghost" })}
          >
            Log In
          </Link>
          <Link href="/signup" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
            Book a Demo
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-surface/50 text-foreground sm:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <div className="glass border-t border-border/60 px-4 pb-6 pt-2 sm:hidden">
          <nav className="flex flex-col">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="border-b border-border/40 py-3.5 text-base font-medium text-foreground/90"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2.5">
            <Link
              href="/login"
              className={buttonVariants({ variant: "outline", className: "w-full" })}
              onClick={() => setOpen(false)}
            >
              Log In
            </Link>
            <Link
              href="/signup"
              className={buttonVariants({ className: "w-full" })}
              onClick={() => setOpen(false)}
            >
              Book a Demo
            </Link>
          </div>
          <p className="mt-4 text-center text-sm font-semibold text-primary">
            $30 per seat / month
          </p>
        </div>
      )}
    </header>
  );
}
