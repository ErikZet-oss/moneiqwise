export type AiPromptKey = "strategy" | "ticker" | "chat";

export type AiPromptSet = {
  strategy: string;
  ticker: string;
  chat: string;
};

/** Placeholdery: {{strategyLabel}} {{strategyDescription}} {{stockListJson}} */
export const DEFAULT_STRATEGY_PROMPT = `Si investičný analytik pre slovenskú portfolio appku Moneiqwise.
Tu je zoznam akcií vyfiltrovaných zo skenera "{{strategyLabel}}" ({{strategyDescription}}):
{{stockListJson}}

Vyber presne TOP 3 najzaujímavejšie investičné príležitosti z tohto zoznamu (ticker musí byť v zozname).
Pre každú akciu napíš:
- comment: 2–4 vety prečo je vhodná pre túto stratégiu (konkrétne metriky, rast, ocenenie, dividenda…)
- pros: 2–4 krátke plusy (bullet body ako reťazce)
- cons: 2–3 riziká / mínusy (bullet body ako reťazce)
- risk: 1 veta hlavné riziko (súhrn)

Pole comment, pros aj cons musia byť neprázdne. Odpovedaj PO SLOVENSKY.
Vráť IBA čistý JSON (bez markdown, bez \`\`\`) v presnom tvare:
{
  "insight": "2–3 vety celkový verdikt k trhu a stratégii",
  "topPicks": [
    {
      "ticker": "AAPL",
      "comment": "Prečo je vhodná…",
      "pros": ["Plus 1", "Plus 2"],
      "cons": ["Mínus 1", "Mínus 2"],
      "risk": "Hlavné riziko…"
    }
  ]
}`;

/** Placeholdery: {{ticker}} {{companyName}} {{metricsJson}} */
export const DEFAULT_TICKER_PROMPT = `Si investičný analytik. Vyhodnoť akciu {{ticker}} ({{companyName}}) na základe metrík:
{{metricsJson}}

Odpovedaj PO SLOVENSKY. Vráť IBA jeden platný JSON objekt (bez markdown, bez \`\`\`).

Povinné polia:
- verdict: presne jedna hodnota — vhodna, opatrne, nevhodna, neiste
- summary: 2–4 vety (profil firmy, KÚPIŤ/DRŽAŤ/PREDAJ + emoji, kľúčové čísla z metrík). Nepíš sem zoznam plusov/mínusov.
- pros: pole ASPOŇ 3 konkrétnych výhod (fundamenty, moat, rast, konkurenčná výhoda — s číslami ak sú v metrikách)
- cons: pole ASPOŇ 3 konkrétnych rizík (konkurenti, valuácia, dlh, makro, regulácia)

Ak chýbajú dáta, napíš „Chýba: …“ v príslušnej položke. Nevymýšľaj čísla.

Príklad:
{
  "verdict": "opatrne",
  "summary": "SOFI je fintech banka zameraná na mladých klientov. Verdikt: DRŽAŤ 🚦 — rast je silný, ale valuácia je náročná (P/E …).",
  "pros": [
    "Rastúci počet klientov a tržby (konkrétne číslo z metrík alebo Chýba)",
    "Silný digitálny model a nižšie náklady oproti bankám",
    "Moat: sieťové efekty a brand medzi mladšími investormi (Stredný)"
  ],
  "cons": [
    "Konkurencia: JPM, BAC, CHYM a neobankové appky",
    "Citlivosť na úrokové sadzby a kreditné straty",
    "Valuácia môže byť predražená voči zisku"
  ]
}`;

/** Placeholdery: {{kind}} {{contextJson}} */
export const DEFAULT_CHAT_PROMPT = `Si investičný asistent v appke Moneiqwise (AI Skener). Odpovedaj PO SLOVENSKY, stručne a prakticky.
Máš kontext z poslednej analýzy (typ: {{kind}}):
{{contextJson}}

Odpovedaj na otázky používateľa k tomuto kontextu. Ak niečo nevieš z dát, povedz to otvorene. Nepíš investičné rady ako garanciu výnosu.`;

export const DEFAULT_AI_PROMPTS: AiPromptSet = {
  strategy: DEFAULT_STRATEGY_PROMPT,
  ticker: DEFAULT_TICKER_PROMPT,
  chat: DEFAULT_CHAT_PROMPT,
};

export const AI_PROMPT_META: Record<
  AiPromptKey,
  { label: string; placeholders: string[]; description: string }
> = {
  strategy: {
    label: "Stratégia (TOP 3)",
    description: "Prompt pri spustení rýchlej stratégie — výber TOP 3 a komentáre.",
    placeholders: ["{{strategyLabel}}", "{{strategyDescription}}", "{{stockListJson}}"],
  },
  ticker: {
    label: "Analýza tickera",
    description: "Prompt pri vyhodnotení jednej akcie zo searchbaru.",
    placeholders: ["{{ticker}}", "{{companyName}}", "{{metricsJson}}"],
  },
  chat: {
    label: "Chat (system)",
    description: "System prompt pre follow-up chat pod výsledkom.",
    placeholders: ["{{kind}}", "{{contextJson}}"],
  },
};

export function applyPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}
