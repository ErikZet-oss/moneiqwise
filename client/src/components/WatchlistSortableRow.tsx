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
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
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
      }}
      className={cn(
        "relative",
        className,
        isDragging && "z-30 opacity-95 shadow-md ring-1 ring-primary/25 rounded-lg",
      )}
    >
      {!disabled ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label="Presunúť položku"
          onClick={(event) => event.stopPropagation()}
          className="absolute left-0 top-0 z-20 flex h-full w-8 touch-none cursor-grab items-center justify-center text-muted-foreground/60 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 pointer-events-none" aria-hidden />
        </button>
      ) : null}
      {children}
    </div>
  );
}
