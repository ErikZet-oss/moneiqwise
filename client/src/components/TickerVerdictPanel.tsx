import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FinanceTermText } from "@/components/FinanceTermText";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type TickerVerdictData = {
  verdict: "vhodna" | "opatrne" | "nevhodna" | "neiste";
  summary: string;
  pros: string[];
  cons: string[];
  cached?: boolean;
};

function verdictBadge(v: TickerVerdictData["verdict"]) {
  switch (v) {
    case "vhodna":
      return { label: "Vhodná", className: "bg-green-600 hover:bg-green-600" };
    case "opatrne":
      return { label: "Opatrne", className: "bg-amber-600 hover:bg-amber-600" };
    case "nevhodna":
      return { label: "Nevhodná", className: "bg-red-600 hover:bg-red-600" };
    default:
      return { label: "Neisté", className: "bg-muted-foreground hover:bg-muted-foreground" };
  }
}

/** Rozdelí summary na číslované sekcie (1) Názov …). */
function parseNumberedSections(text: string): Array<{ title: string; body: string }> | null {
  const matches = Array.from(text.matchAll(/(?:^|\n)(\d+)\)\s*([^\n]+)\n?([\s\S]*?)(?=\n\d+\)\s|$)/g));
  if (matches.length < 2) return null;
  return matches.map((m) => ({
    title: m[2].trim(),
    body: m[3].trim(),
  }));
}

/** Ak summary nemá sekcie, zobraz len úvodný odsek pred prvou sekciou alebo celý text. */
function splitIntroAndSections(summary: string): { intro: string; sections: Array<{ title: string; body: string }> | null } {
  const sections = parseNumberedSections(summary);
  if (sections?.length) {
    const intro = summary.split(/\n\d+\)/)[0]?.trim() ?? "";
    return { intro, sections };
  }
  return { intro: summary.trim(), sections: null };
}

type Props = {
  data: TickerVerdictData;
};

export function TickerVerdictPanel({ data }: Props) {
  const badge = verdictBadge(data.verdict);
  const { intro, sections } = splitIntroAndSections(data.summary);
  const hasPros = data.pros.length > 0;
  const hasCons = data.cons.length > 0;

  return (
    <Card className="border-primary/20 bg-primary/[0.04]">
      <CardContent className="p-3 space-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Sparkles className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">Claude verdikt</span>
          <Badge className={`text-[8px] h-4 px-1.5 ${badge.className}`}>{badge.label}</Badge>
          {data.cached && (
            <Badge variant="outline" className="text-[8px] h-4 px-1">
              cache
            </Badge>
          )}
        </div>

        {intro ? (
          <FinanceTermText text={intro} as="p" className="text-xs leading-relaxed whitespace-pre-line" />
        ) : null}

        {sections?.map((sec, i) => (
          <div key={i} className="rounded-md border border-border/60 bg-background/60 p-2 space-y-1">
            <p className="text-[10px] font-semibold text-foreground">{sec.title}</p>
            <FinanceTermText
              text={sec.body}
              as="p"
              className="text-[10px] leading-relaxed text-muted-foreground whitespace-pre-line"
            />
          </div>
        ))}

        {!sections && !intro && data.summary ? (
          <FinanceTermText
            text={data.summary}
            as="p"
            className="text-xs leading-relaxed whitespace-pre-line"
          />
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
          <div
            className={cn(
              "rounded-md border p-2.5 space-y-1.5",
              hasPros ? "border-green-500/30 bg-green-500/5" : "border-border/60 bg-muted/20",
            )}
          >
            <p className="text-[10px] font-semibold text-green-600 dark:text-green-400">Plusy</p>
            {hasPros ? (
              <ul className="text-[10px] text-foreground/90 space-y-1 list-disc pl-3.5">
                {data.pros.map((p, i) => (
                  <li key={i}>
                    <FinanceTermText text={p} className="inline" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[9px] text-muted-foreground">Bez uvedených plusov.</p>
            )}
          </div>

          <div
            className={cn(
              "rounded-md border p-2.5 space-y-1.5",
              hasCons ? "border-red-500/30 bg-red-500/5" : "border-border/60 bg-muted/20",
            )}
          >
            <p className="text-[10px] font-semibold text-red-500">Riziká / mínusy</p>
            {hasCons ? (
              <ul className="text-[10px] text-foreground/90 space-y-1 list-disc pl-3.5">
                {data.cons.map((c, i) => (
                  <li key={i}>
                    <FinanceTermText text={c} className="inline" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[9px] text-muted-foreground">Bez uvedených rizík.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
