import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
};

export function WatchlistSortableRow({ id, disabled, className, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 30 : undefined,
        touchAction: disabled ? undefined : "none",
      }}
      className={cn(
        "relative",
        className,
        !disabled && "cursor-grab active:cursor-grabbing select-none",
        isDragging && "z-30 opacity-95 shadow-md ring-1 ring-primary/25 rounded-lg",
      )}
      {...(disabled ? {} : { ...attributes, ...listeners })}
    >
      {!disabled ? (
        <div
          className="pointer-events-none absolute left-1 top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground/60"
          aria-hidden
        >
          <GripVertical className="h-4 w-4" />
        </div>
      ) : null}
      {children}
    </div>
  );
}
