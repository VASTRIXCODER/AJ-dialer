import { cn } from "@/lib/utils";

export function Avatar({
  initials,
  color,
  size = "md",
  className,
  ring = false,
}: {
  initials: string;
  color: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  ring?: boolean;
}) {
  const sizes = {
    xs: "h-7 w-7 text-[10px]",
    sm: "h-9 w-9 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        sizes[size],
        ring && "ring-2 ring-surface",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
      }}
    >
      {initials}
    </span>
  );
}
