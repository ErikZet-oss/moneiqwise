import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

type DemoEnterProps = {
  pathToken: string;
};

export default function DemoEnter({ pathToken }: DemoEnterProps) {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/demo/enter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ path: pathToken }),
        });

        if (!res.ok) {
          let message = "Demo prihlasenie zlyhalo.";
          try {
            const body = await res.json();
            if (typeof body?.message === "string" && body.message) {
              message = body.message;
            }
          } catch {
            /* ignore */
          }
          if (!cancelled) setError(message);
          return;
        }

        await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
        if (!cancelled) setLocation("/");
      } catch {
        if (!cancelled) setError("Demo prihlasenie zlyhalo. Skontroluj pripojenie.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathToken, setLocation]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <p className="text-destructive font-medium">{error}</p>
          <button
            type="button"
            className="text-sm text-primary underline underline-offset-4"
            onClick={() => setLocation("/")}
          >
            Spat na uvod
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-muted-foreground">Prihlasujem demo ucet...</p>
      </div>
    </div>
  );
}
