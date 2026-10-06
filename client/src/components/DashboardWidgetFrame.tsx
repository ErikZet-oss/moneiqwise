import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DASHBOARD_WIDGET_META,
  type DashboardWidgetId,
} from "@/lib/dashboardLayout";
import { cn } from "@/lib/utils";

type Props = {
  id: DashboardWidgetId;
  editing: boolean;
  visible: boolean;
  onToggleVisible: () => void;
  children: React.ReactNode;
  /** Keď widget na aktuálnom breakpointe nemá obsah. */
  empty?: boolean;
  emptyHint?: string;
};

export function DashboardWidgetFrame({
  id,
  editing,
  visible,
  onToggleVisible,
  children,
  empty = false,
  emptyHint,
}: Props) {
  const meta = DASHBOARD_WIDGET_META[id];
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editing });

  if (!editing && !visible) return null;
  if (!editing && empty) return null;

  const showPlaceholder = editing && (empty || !visible);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 40 : undefined,
      }}
      data-testid={`dashboard-widget-${id}`}
      data-editing={editing ? "true" : undefined}
      className={cn(
        "relative",
        editing && "rounded-xl ring-1 ring-border/80",
        editing && isDragging && "z-40 opacity-95 shadow-lg ring-primary/30",
        editing && !visible && "opacity-45 grayscale",
      )}
    >
      {editing && (
        <div className="absolute -top-2.5 right-2 z-30 flex items-center gap-1">
          {!meta.required && (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="h-8 w-8 rounded-full shadow-sm"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible();
              }}
              aria-label={visible ? `Skryť ${meta.label}` : `Zobraziť ${meta.label}`}
              data-testid={`dashboard-widget-toggle-${id}`}
            >
              {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          )}
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={`Presunúť ${meta.label}`}
            data-testid={`dashboard-widget-drag-${id}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              "bg-secondary text-muted-foreground shadow-sm",
              "touch-none cursor-grab active:cursor-grabbing",
            )}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4 pointer-events-none" aria-hidden />
          </button>
        </div>
      )}

      {showPlaceholder ? (
        <div
          className={cn(
            "flex min-h-[4.5rem] items-center justify-center rounded-xl border border-dashed",
            "border-muted-foreground/30 bg-muted/30 px-4 py-6",
            editing && "pt-8",
          )}
        >
          <div className="text-center">
            <p className="text-sm font-medium text-muted-foreground">{meta.label}</p>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">
              {!visible
                ? "Skryté — ťuknite na oko pre zobrazenie"
                : emptyHint ?? "Na tomto zobrazení bez samostatného bloku"}
            </p>
          </div>
        </div>
      ) : (
        <div className={cn(editing && "pt-3 pointer-events-none")}>{children}</div>
      )}
    </div>
  );
}
