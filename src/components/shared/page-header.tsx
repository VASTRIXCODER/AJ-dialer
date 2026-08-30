import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

export function PageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `page-reveal` used to live here. It is a 600ms staggered translateY(14px)
    // applied to the top-level sections of EVERY page — 44 files, including
    // /leads, /admin and /reports — and `(app)/template.tsx` remounts the outlet
    // on every navigation, so a rep changing route watched tables and numbers
    // slide up into place, one block at a time, every single time. It is a
    // Stage effect and it is now opt-in: a Stage route adds the class itself.
    // The opacity-only cross-fade in template.tsx is the route transition.
    <div className={cn("mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8", className)}>
      {children}
    </div>
  );
}
