"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";
import { Z } from "@/lib/z-layers";

type Side = "top" | "bottom" | "left" | "right";

const GAP = 8;

/**
 * Tooltip — hover AND focus triggered (keyboard users get the same help), with
 * a 300ms open delay so it never flickers on a pass-through. Rendered in a
 * portal (position: fixed, measured off the trigger) so it can't be clipped by
 * an overflow container, and referenced via aria-describedby while visible so
 * screen readers announce it on focus.
 *
 * The child must be a single element (it receives the trigger handlers).
 * Escape dismisses, per the WAI-ARIA tooltip pattern.
 */
export function Tooltip({
  content,
  side = "top",
  delay = 300,
  children,
}: {
  content: ReactNode;
  side?: Side;
  /** ms before showing on hover (focus shows immediately). */
  delay?: number;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const centers: Record<Side, { top: number; left: number }> = {
      top: { top: r.top - GAP, left: r.left + r.width / 2 },
      bottom: { top: r.bottom + GAP, left: r.left + r.width / 2 },
      left: { top: r.top + r.height / 2, left: r.left - GAP },
      right: { top: r.top + r.height / 2, left: r.right + GAP },
    };
    setPos(centers[side]);
  }, [side]);

  const show = useCallback(
    (immediate: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      if (immediate) {
        place();
        setOpen(true);
        return;
      }
      timer.current = setTimeout(() => {
        place();
        setOpen(true);
      }, delay);
    },
    [delay, place],
  );

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // Reposition if the page scrolls/resizes underneath an open tooltip.
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, hide, place]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!isValidElement(children)) return children;
  const childProps = children.props as {
    onMouseEnter?: (e: unknown) => void;
    onMouseLeave?: (e: unknown) => void;
    onFocus?: (e: unknown) => void;
    onBlur?: (e: unknown) => void;
  };

  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      // Preserve the child's own ref if it has one (React 19: ref is a prop).
      const childRef = (children.props as { ref?: unknown }).ref;
      if (typeof childRef === "function") childRef(node);
      else if (childRef && typeof childRef === "object")
        (childRef as { current: HTMLElement | null }).current = node;
    },
    "aria-describedby": open ? id : undefined,
    onMouseEnter: (e: unknown) => {
      childProps.onMouseEnter?.(e);
      show(false);
    },
    onMouseLeave: (e: unknown) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: unknown) => {
      childProps.onFocus?.(e);
      show(true);
    },
    onBlur: (e: unknown) => {
      childProps.onBlur?.(e);
      hide();
    },
  } as Record<string, unknown>);

  const translate: Record<Side, string> = {
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2",
    left: "-translate-x-full -translate-y-1/2",
    right: "-translate-y-1/2",
  };

  return (
    <>
      {trigger}
      {open && pos && (
        <Portal>
          <div
            id={id}
            role="tooltip"
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: Z.tooltip }}
            className={cn(
              "pointer-events-none max-w-xs rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs text-foreground shadow-lift",
              translate[side],
            )}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
