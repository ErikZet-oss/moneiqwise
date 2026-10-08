import { cn } from "@/lib/utils";
import { useMobileUi, type MobileUiMode } from "@/hooks/useMobileUi";

export function MobileUiToggle({
  pinned = false,
  className,
}: {
  pinned?: boolean;
  className?: string;
}) {
  const { mode, setMode } = useMobileUi();

  const control = (
    <div
      className={cn(
        "inline-flex rounded-full border border-[#2c3137] bg-[#050607]/90 p-1 shadow-lg backdrop-blur",
        className,
      )}
      role="group"
      aria-label="Vzhľad aplikácie"
      data-testid="toggle-mobile-ui"
    >
      <Segment label="Klasický" value="classic" mode={mode} setMode={setMode} />
      <Segment label="Nový" value="redesign" mode={mode} setMode={setMode} />
    </div>
  );

  if (!pinned) return control;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-[max(10px,env(safe-area-inset-top))]">
      <div className="pointer-events-auto">{control}</div>
    </div>
  );
}

function Segment({
  label,
  value,
  mode,
  setMode,
}: {
  label: string;
  value: MobileUiMode;
  mode: MobileUiMode;
  setMode: (mode: MobileUiMode) => void;
}) {
  const active = mode === value;
  return (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={cn(
        "min-h-9 rounded-full px-4 text-[13px] font-medium leading-4",
        active
          ? "border border-[#2c3137] bg-[#1d2125] text-[#f3f5f6]"
          : "text-[#6b727c]",
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
