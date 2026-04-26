import { type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Nápoveda pri otázniku — vždy Popover (klepnutie/klik).
 * Radix Tooltip na dotyku nefunguje spoľahlivo; zdieľané z-50 s Sheet/Dialog
 * schovávalo obsah pod overlay.
 */
export function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full p-0.5 touch-manipulation",
            "text-muted-foreground hover:text-foreground active:opacity-80",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
          aria-label={`Pomoc: ${title}`}
        >
          <HelpCircle className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        className={cn(
          "z-[100] p-3 shadow-lg outline-none",
          "w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:w-72 sm:max-w-[280px]",
        )}
      >
        <p className="font-semibold mb-1 text-sm leading-snug">{title}</p>
        <div className="text-xs space-y-1.5 leading-relaxed text-popover-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
