"use client";

import Link from "next/link";
import { Wordmark } from "@/components/brand/logo";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const links = [
  { label: "Platform", href: "#platform" },
  { label: "Parallel dialing", href: "#parallel" },
  { label: "AI agent", href: "#ai" },
  { label: "Pricing", href: "#pricing" },
];

export function MarketingNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
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
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/login"
            className={buttonVariants({ size: "sm", variant: "ghost", className: "hidden sm:inline-flex" })}
          >
            Sign in
          </Link>
          <Link href="/signup" className={buttonVariants({ size: "sm" })}>
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
