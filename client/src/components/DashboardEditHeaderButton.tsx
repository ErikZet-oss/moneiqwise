import { useEffect } from "react";
import { useLocation } from "wouter";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";

const headerIconButton = "h-8 w-8 shrink-0 [border-color:hsl(var(--border))]";

/** Pero / Hotovo v hlavičke — len na Prehľade (`/`). */
export function DashboardEditHeaderButton() {
  const [location] = useLocation();
  const { editing, setEditing, resetLayout } = useDashboardLayout();

  useEffect(() => {
    if (location !== "/" && editing) setEditing(false);
  }, [location, editing, setEditing]);

  if (location !== "/") return null;

  if (editing) {
    return (
      <div className="flex shrink-0 items-center gap-2" data-testid="dashboard-edit-toolbar">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-xs [border-color:hsl(var(--border))]"
          onClick={resetLayout}
          data-testid="button-dashboard-reset-layout"
        >
          Predvolené
        </Button>
        <Button
          type="button"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setEditing(false)}
          aria-label="Hotovo — ukončiť úpravu prehľadu"
          data-testid="button-dashboard-edit-done"
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={headerIconButton}
      onClick={() => setEditing(true)}
      aria-label="Upraviť prehľad"
      data-testid="button-dashboard-edit"
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}
