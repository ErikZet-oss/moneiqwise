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

function isProfileSection(title: string): boolean {
  return /profil|verdikt/i.test(title);
}

function isTargetSection(title: string): boolean {
  return /cieľov|cena\s*12|target/i.test(title);
}

function parseTradingAction(
  text: string,
  verdict: TickerVerdictData["verdict"],
): "BUY" | "HOLD" | "SELL" {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (/\b(predaj|sell)\b/.test(normalized) || /🔴/.test(text)) return "SELL";
  if (/\b(kup|buy)\b/.test(normalized) || /🟢/.test(text)) return "BUY";
  if (/\b(drz|hold)\b/.test(normalized) || /🚦/.test(text)) return "HOLD";

  switch (verdict) {
    case "vhodna":
      return "BUY";
    case "nevhodna":
      return "SELL";
    default:
      return "HOLD";
  }
}

function formatPriceToken(value: string, currency?: string): string {
  const v = value.trim().replace(/\s+/g, "");
  if (!currency) return v;
  const c = currency.toUpperCase();
  if (c === "€" || c === "EUR") return `${v} €`;
  if (c === "$" || c === "USD") return `$${v}`;
  if (c === "CHF") return `${v} CHF`;
  return `${v} ${c}`;
}

function tryParseTargetRange(searchText: string): string | null {
  const odDo = searchText.match(
    /od\s+([\d.,]+)\s*(€|\$|USD|EUR|CHF)?\s+do\s+([\d.,]+)\s*(€|\$|USD|EUR|CHF)?/i,
  );
  if (odDo) {
    const cur = odDo[2] || odDo[4] || "";
    return `${formatPriceToken(odDo[1], cur)} – ${formatPriceToken(odDo[3], cur || odDo[2])}`;
  }

  const az = searchText.match(
    /([\d.,]+)\s*(€|\$|USD|EUR|CHF)?\s+až\s+([\d.,]+)\s*(€|\$|USD|EUR|CHF)?/i,
  );
  if (az) {
    const cur = az[2] || az[4] || "";
    return `${formatPriceToken(az[1], cur)} – ${formatPriceToken(az[3], cur || az[2])}`;
  }

  const dash = searchText.match(
    /([\d.,]+)\s*(€|\$|USD|EUR|CHF)\s*[-–—]\s*([\d.,]+)\s*(€|\$|USD|EUR|CHF)?/i,
  );
  if (dash) {
    const cur = dash[2] || dash[4] || "";
    return `${formatPriceToken(dash[1], cur)} – ${formatPriceToken(dash[3], cur || dash[2])}`;
  }

  const lowHigh = searchText.match(
    /(?:nízk[aá]|minimum|min\.?|dno)[:\s]*([\d.,]+)\s*(€|\$|USD|EUR|CHF)?[\s\S]*?(?:vysok[aá]|maximum|max\.?|strop)[:\s]*([\d.,]+)\s*(€|\$|USD|EUR|CHF)?/i,
  );
  if (lowHigh) {
    const cur = lowHigh[2] || lowHigh[4] || "";
    return `${formatPriceToken(lowHigh[1], cur)} – ${formatPriceToken(lowHigh[3], cur || lowHigh[2])}`;
  }

  const highLow = searchText.match(
    /(?:vysok[aá]|maximum|max\.?|strop)[:\s]*([\d.,]+)\s*(€|\$|USD|EUR|CHF)?[\s\S]*?(?:nízk[aá]|minimum|min\.?|dno)[:\s]*([\d.,]+)\s*(€|\$|USD|EUR|CHF)?/i,
  );
  if (highLow) {
    const cur = highLow[4] || highLow[2] || "";
    return `${formatPriceToken(highLow[3], cur || highLow[4])} – ${formatPriceToken(highLow[1], cur || highLow[2])}`;
  }

  return null;
}

function parseTargetRange(summary: string, sections: Array<{ title: string; body: string }> | null): string | null {
  const targetSec = sections?.find((s) => isTargetSection(s.title));
  if (targetSec?.body) {
    const fromTarget = tryParseTargetRange(targetSec.body);
    if (fromTarget) return fromTarget;
  }
  return tryParseTargetRange(summary);
}

function tradingActionBadge(action: "BUY" | "HOLD" | "SELL") {
  switch (action) {
    case "BUY":
      return { label: "BUY", className: "bg-green-600 hover:bg-green-600 text-white" };
    case "SELL":
      return { label: "SELL", className: "bg-red-600 hover:bg-red-600 text-white" };
    default:
      return { label: "HOLD", className: "bg-amber-600 hover:bg-amber-600 text-white" };
  }
}

function VerdictSideBox({
  action,
  targetRange,
}: {
  action: "BUY" | "HOLD" | "SELL";
  targetRange: string | null;
}) {
  const badge = tradingActionBadge(action);

  return (
    <div className="shrink-0 w-[4.5rem] sm:w-20 rounded-md border border-border/70 bg-background/80 p-1.5 flex flex-col items-center justify-center gap-1 text-center">
      <Badge className={`text-[9px] h-5 px-2 font-bold tracking-wide ${badge.className}`}>
        {badge.label}
      </Badge>
      {targetRange ? (
        <div className="space-y-0.5">
          <p className="text-[7px] uppercase tracking-wide text-muted-foreground leading-none">Cieľ 12M</p>
          <p className="text-[8px] font-semibold tabular-nums text-foreground leading-tight">{targetRange}</p>
        </div>
      ) : null}
    </div>
  );
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
  const profileSection = sections?.find((s) => isProfileSection(s.title));
  const tradingAction = parseTradingAction(
    [profileSection?.body, intro, data.summary].filter(Boolean).join(" "),
    data.verdict,
  );
  const targetRange = parseTargetRange(data.summary, sections);

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
          <div className="flex gap-2 items-stretch">
            <div className="flex-1 min-w-0">
              <FinanceTermText text={intro} as="p" className="text-xs leading-relaxed whitespace-pre-line" />
            </div>
            {!sections ? <VerdictSideBox action={tradingAction} targetRange={targetRange} /> : null}
          </div>
        ) : null}

        {sections?.map((sec, i) => {
          if (isTargetSection(sec.title) && targetRange) return null;

          if (isProfileSection(sec.title)) {
            return (
              <div key={i} className="flex gap-2 items-stretch">
                <div className="flex-1 min-w-0 rounded-md border border-border/60 bg-background/60 p-2 space-y-1">
                  <p className="text-[10px] font-semibold text-foreground">{sec.title}</p>
                  <SectionBody title={sec.title} body={sec.body} />
                </div>
                <VerdictSideBox action={tradingAction} targetRange={targetRange} />
              </div>
            );
          }

          return (
            <div key={i} className="rounded-md border border-border/60 bg-background/60 p-2 space-y-1">
              <p className="text-[10px] font-semibold text-foreground">{sec.title}</p>
              <SectionBody title={sec.title} body={sec.body} />
            </div>
          );
        })}

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
