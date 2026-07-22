import { type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Slovenské vysvetlenia bežných investičných skratiek. */
export const FINANCE_TERM_GLOSSARY: Record<string, { title: string; explanation: string }> = {
  "P/E": {
    title: "P/E (Price / Earnings)",
    explanation:
      "Pomer ceny akcie k zisku na akciu. Vyššie P/E často znamená, že trh očakáva rast; nižšie môže znamenať lacnejšie ocenenie (alebo riziká).",
  },
  PE: {
    title: "P/E (Price / Earnings)",
    explanation:
      "Pomer ceny akcie k zisku na akciu. Vyššie P/E často znamená, že trh očakáva rast; nižšie môže znamenať lacnejšie ocenenie (alebo riziká).",
  },
  EPS: {
    title: "EPS (Earnings Per Share)",
    explanation: "Zisk na jednu akciu. Ukazuje, koľko firma zarobí v prepočte na jednu emitovanú akciu.",
  },
  PEG: {
    title: "PEG (Price / Earnings to Growth)",
    explanation:
      "P/E vydelené očakávaným rastom ziskov. Hodnota okolo 1 sa často považuje za „férovú“; pod 1 môže byť atraktívnejšie (GARP).",
  },
  ROE: {
    title: "ROE (Return on Equity)",
    explanation: "Návratnosť vlastného kapitálu. Koľko zisku firma vytvorí z peňazí akcionárov — vyššie je zvyčajne lepšie.",
  },
  ROA: {
    title: "ROA (Return on Assets)",
    explanation: "Návratnosť aktív. Ako efektívne firma využíva svoj majetok na tvorbu zisku.",
  },
  ROI: {
    title: "ROI (Return on Investment)",
    explanation: "Návratnosť investície — zjednodušene pomer zisku k vynaloženým prostriedkom.",
  },
  RSI: {
    title: "RSI (Relative Strength Index)",
    explanation:
      "Technický indikátor hybnosti (0–100). Pod ~30 často „prepredané“, nad ~70 „prekúpené“ — nie je to však automatický signál na nákup/predaj.",
  },
  EBITDA: {
    title: "EBITDA",
    explanation:
      "Zisk pred úrokmi, daňami, odpismi a amortizáciou. Ukazuje prevádzkovú výkonnosť bez vplyvu financovania a odpisov.",
  },
  "EV/EBITDA": {
    title: "EV / EBITDA",
    explanation:
      "Hodnota firmy (enterprise value) k EBITDA. Bežný ukazovateľ ocenenia, porovnáva firmy s rôznym dlhom.",
  },
  "P/B": {
    title: "P/B (Price / Book)",
    explanation: "Pomer ceny akcie k účtovnej hodnote vlastného kapitálu na akciu.",
  },
  PB: {
    title: "P/B (Price / Book)",
    explanation: "Pomer ceny akcie k účtovnej hodnote vlastného kapitálu na akciu.",
  },
  "P/S": {
    title: "P/S (Price / Sales)",
    explanation: "Pomer trhovej ceny k tržbám na akciu. Užitočné pri firmách s malým alebo nestabilným ziskom.",
  },
  PS: {
    title: "P/S (Price / Sales)",
    explanation: "Pomer trhovej ceny k tržbám na akciu. Užitočné pri firmách s malým alebo nestabilným ziskom.",
  },
  "P/FCF": {
    title: "P / FCF",
    explanation: "Pomer ceny k voľnému cash flow. Ukazuje, koľko platíte za hotovosť, ktorú firma reálne generuje.",
  },
  FCF: {
    title: "FCF (Free Cash Flow)",
    explanation: "Voľný cash flow — hotovosť po investíciách do chodu firmy, ktorú môže použiť na dividendy, dlh alebo spätný odkup.",
  },
  "DIV.": {
    title: "Dividend yield",
    explanation: "Dividendový výnos — ročná dividenda ako percento z ceny akcie.",
  },
  DIV: {
    title: "Dividend yield",
    explanation: "Dividendový výnos — ročná dividenda ako percento z ceny akcie.",
  },
  YIELD: {
    title: "Yield (výnos)",
    explanation: "Výnos z investície, typicky dividendový výnos alebo výnos do splatnosti.",
  },
  PAYOUT: {
    title: "Payout ratio",
    explanation: "Podiel zisku, ktorý firma vyplatí ako dividendu. Príliš vysoký payout môže ohroziť udržateľnosť dividendy.",
  },
  "DEBT/EQ": {
    title: "Debt / Equity",
    explanation: "Pomer dlhu k vlastnému kapitálu. Vyššie číslo = viac pákového efektu a vyššie finančné riziko.",
  },
  "D/E": {
    title: "Debt / Equity (D/E)",
    explanation: "Pomer dlhu k vlastnému kapitálu. Vyššie číslo = viac pákového efektu a vyššie finančné riziko.",
  },
  CAP: {
    title: "Market Cap",
    explanation: "Trhová kapitalizácia — cena akcie × počet akcií. Veľkosť firmy na trhu.",
  },
  "MARKET CAP": {
    title: "Market Cap",
    explanation: "Trhová kapitalizácia — cena akcie × počet akcií. Veľkosť firmy na trhu.",
  },
  SMA20: {
    title: "SMA 20",
    explanation: "20-dňový kĺzavý priemer ceny — krátkodobý trend.",
  },
  SMA50: {
    title: "SMA 50",
    explanation: "50-dňový kĺzavý priemer ceny — strednodobý trend.",
  },
  SMA200: {
    title: "SMA 200",
    explanation: "200-dňový kĺzavý priemer ceny — dlhodobý trend.",
  },
  GARP: {
    title: "GARP",
    explanation: "Growth At a Reasonable Price — rastové akcie za rozumné ocenenie (nie extrémne drahé).",
  },
  BETA: {
    title: "Beta",
    explanation: "Citlivosť akcie na pohyb trhu. Beta > 1 = volatilnejšia ako trh; < 1 = pokojnejšia.",
  },
  CAGR: {
    title: "CAGR",
    explanation: "Priemerný ročný rast (compound annual growth rate) za určité obdobie.",
  },
  TTM: {
    title: "TTM (Trailing Twelve Months)",
    explanation: "Údaje za posledných 12 mesiacov (nie kalendárny rok).",
  },
  YOY: {
    title: "YoY (Year over Year)",
    explanation: "Medziročné porovnanie — zmena oproti rovnakému obdobiu predchádzajúceho roka.",
  },
  QOQ: {
    title: "QoQ (Quarter over Quarter)",
    explanation: "Medzikvartálne porovnanie — zmena oproti predchádzajúcemu štvrťroku.",
  },
};

/** Dlhšie frazy skôr, aby „EV/EBITDA“ vyhralo pred „EBITDA“. */
const TERM_KEYS = Object.keys(FINANCE_TERM_GLOSSARY).sort((a, b) => b.length - a.length);

const TERM_REGEX = new RegExp(
  `(?<![A-Za-z0-9])(${TERM_KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`,
  "gi",
);

function lookupTerm(raw: string) {
  const exact = FINANCE_TERM_GLOSSARY[raw] ?? FINANCE_TERM_GLOSSARY[raw.toUpperCase()];
  if (exact) return exact;
  const key = TERM_KEYS.find((k) => k.toUpperCase() === raw.toUpperCase());
  return key ? FINANCE_TERM_GLOSSARY[key] : null;
}

function TermChip({ term, entry }: { term: string; entry: { title: string; explanation: string } }) {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline p-0 m-0 border-0 bg-transparent align-baseline cursor-help touch-manipulation",
            "font-semibold text-primary underline decoration-dotted underline-offset-2",
            "hover:text-primary/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
          )}
          aria-label={`Vysvetlenie: ${entry.title}`}
        >
          {term}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "z-[100] p-2.5 shadow-lg outline-none",
          "w-[min(18rem,calc(100vw-2rem))] max-w-[280px]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-semibold text-[11px] leading-snug mb-1">{entry.title}</p>
        <p className="text-[10px] leading-relaxed text-muted-foreground">{entry.explanation}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Text s klikateľnými finančnými skratkami (EPS, PEG, ROE…). */
export function FinanceTermText({
  text,
  className,
  as: Tag = "span",
}: {
  text: string;
  className?: string;
  as?: "span" | "p" | "div";
}) {
  if (!text) return null;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  const re = new RegExp(TERM_REGEX.source, TERM_REGEX.flags);
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const term = match[1]!;
    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    const entry = lookupTerm(term);
    if (entry) {
      nodes.push(<TermChip key={`t-${i++}-${start}`} term={term} entry={entry} />);
    } else {
      nodes.push(term);
    }
    lastIndex = start + term.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return <Tag className={className}>{nodes.length ? nodes : text}</Tag>;
}
