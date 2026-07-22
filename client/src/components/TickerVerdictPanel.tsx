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

/** Ak summary má číslované sekcie, zobraz len boxy (bez duplicitného úvodu). */
function splitIntroAndSections(summary: string): { intro: string; sections: Array<{ title: string; body: string }> | null } {
  const sections = parseNumberedSections(summary);
  if (sections?.length) {
    return { intro: "", sections };
  }
  return { intro: summary.trim(), sections: null };
}

const METRIC_LABELS =
  "Market Cap|Forward P/E|P/E|PEG|EPS \\(ttm\\)|EPS|Debt/Eq|ROE|ROA|Dividend %|Dividend|Payout|Profit Margin|Oper\\. Margin|Gross Margin|Target Price|SMA200|SMA50|RSI|Short Float|Inst Own|Insider Own|Avg Volume|Price|Cap";

function parseNumberedItems(body: string): string[] | null {
  const inline = Array.from(body.matchAll(/\d+\)\s*([\s\S]*?)(?=\s*\d+\)|$)/g))
    .map((m) => m[1].trim())
    .filter(Boolean);
  if (inline.length >= 2) return inline;

  const lines = body
    .split(/\n+/)
    .map((line) => line.replace(/^\d+\)\s*/, "").replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (lines.length >= 2) return lines;

  return null;
}

function parseMetricItems(body: string): string[] | null {
  const labelRe = new RegExp(`\\b(?:${METRIC_LABELS})\\b`, "i");
  if (!labelRe.test(body)) return null;

  const splitBefore = new RegExp(`(?=\\b(?:${METRIC_LABELS})\\b)`, "i");
  const beforeParts = body
    .split(splitBefore)
    .map((p) => p.trim())
    .filter(Boolean);
  if (beforeParts.length >= 2) return beforeParts;

  const splitRe = new RegExp(`\\s*(?:\\||;|,\\s*(?=\\b(?:${METRIC_LABELS})\\b))\\s*`, "i");
  const splitParts = body
    .split(splitRe)
    .map((p) => p.trim())
    .filter(Boolean);
  if (splitParts.length >= 2) return splitParts;

  const pairRe = new RegExp(`((?:${METRIC_LABELS})\\s*:?\\s*[^,|;\\n]+)`, "gi");
  const pairs = Array.from(body.matchAll(pairRe)).map((m) => m[1].trim());
  if (pairs.length >= 2) return pairs;

  return null;
}

function formatSectionItems(title: string, body: string): string[] | null {
  if (/finanč|pitiev|fundament|metrik|valuáci/i.test(title)) {
    return parseMetricItems(body) ?? parseNumberedItems(body);
  }
  if (/konkuren|rizik|hroz|konkurent/i.test(title)) {
    return parseNumberedItems(body) ?? parseMetricItems(body);
  }
  return parseNumberedItems(body);
}

function SectionBody({ title, body }: { title: string; body: string }) {
  const items = formatSectionItems(title, body);
  const itemClass = "text-[10px] leading-relaxed text-muted-foreground";

  if (items?.length) {
    return (
      <ul className={`${itemClass} space-y-1 list-disc pl-3.5 marker:text-foreground`}>
        {items.map((item, i) => (
          <li key={i}>
            <FinanceTermText text={item} className="inline" />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <FinanceTermText text={body} as="p" className={`${itemClass} whitespace-pre-line`} />
  );
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
            <SectionBody title={sec.title} body={sec.body} />
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
