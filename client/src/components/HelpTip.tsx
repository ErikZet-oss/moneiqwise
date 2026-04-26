import { useEffect, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Nápoveda pri otázniku: na desktope tooltip pri hoveri, na dotyku Popover po klepnutí
 * (Radix Tooltip na mobiloch často nefunguje spoľahlivo).
 */
function useTouchFirstUi(): boolean {
  const isMobile = useIsMobile();
  const [noHover, setNoHover] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(hover: none)");
    const onChange = () => setNoHover(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile || noHover;
}

function HelpIconButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full p-0.5",
        "text-muted-foreground hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      aria-label={`Pomoc: ${label}`}
    >
      <HelpCircle className="h-3.5 w-3.5" />
    </button>
  );
}

const bodyClassName = "text-xs space-y-1.5";

export function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  const touchFirst = useTouchFirstUi();

  if (touchFirst) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <HelpIconButton label={title} />
        </PopoverTrigger>
        <PopoverContent
          className="max-w-[min(100vw-2rem,280px)] w-[min(100vw-2rem,280px)]"
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <p className="font-semibold mb-1 text-sm">{title}</p>
          <div className={bodyClassName}>{children}</div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpIconButton label={title} />
      </TooltipTrigger>
      <TooltipContent className="max-w-[280px]">
        <p className="font-semibold mb-1">{title}</p>
        <div className={bodyClassName}>{children}</div>
      </TooltipContent>
    </Tooltip>
  );
}
