import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-4",
        className,
      )}
      {...props}
    />
  );
}
