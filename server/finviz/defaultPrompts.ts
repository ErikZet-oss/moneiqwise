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

Preanalýzuj ich, vyber TOP 3 najzaujímavejšie investičné príležitosti.
Pre každú napíš:
- comment: 1–2 vety prečo je zaujímavá
- risk: 1 veta hlavné riziko

Odpovedaj PO SLOVENSKY. Vráť IBA čistý JSON (bez markdown) v tvare:
{
  "insight": "2–3 vety celkový verdikt k výberu trhu / stratégie",
  "topPicks": [
    { "ticker": "XXX", "comment": "...", "risk": "..." }
  ]
}`;

/** Placeholdery: {{ticker}} {{companyName}} {{metricsJson}} */
export const DEFAULT_TICKER_PROMPT = `Si investičný analytik. Vyhodnoť akciu {{ticker}} ({{companyName}}) na základe metrík z Finviz:
{{metricsJson}}

Odpovedaj PO SLOVENSKY. Vráť IBA čistý JSON:
{
  "verdict": "vhodna" | "opatrne" | "nevhodna" | "neiste",
  "summary": "2–3 vety verdikt či je akcia vhodná na investovanie a prečo",
  "pros": ["...", "..."],
  "cons": ["...", "..."]
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
