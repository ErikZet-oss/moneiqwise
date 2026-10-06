import { useEffect } from "react";
import { useLocation } from "wouter";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";

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
      <div className="flex items-center gap-1" data-testid="dashboard-edit-toolbar">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={resetLayout}
          data-testid="button-dashboard-reset-layout"
        >
          Predvolené
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
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
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => setEditing(true)}
      aria-label="Upraviť prehľad"
      data-testid="button-dashboard-edit"
    >
      <Pencil className="h-4 w-4" />
    </Button>
  );
}
