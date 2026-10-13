import Anthropic from "@anthropic-ai/sdk";
import {
  CLAUDE_DISABLED_MESSAGE,
  isClaudeFeatureEnabled,
} from "../claudeFeatures";
import { formatAnthropicError } from "../finviz/claudeEvaluator";
import type { AiChatBuiltContext } from "./context";

const MODEL =
  process.env.ANTHROPIC_MODEL?.trim().replace(/^["']|["']$/g, "") ||
  "claude-sonnet-5";

function getAnthropicClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const key = raw.replace(/^["']|["']$/g, "").trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY_MISSING");
  return new Anthropic({ apiKey: key });
}

const HTML_SYSTEM = `Si MoneIQWise AI Chat — portfolio asistent. Odpovedaj vždy v slovenčine.

FORMÁT ODPOVEDE (povinné):
- Vráť IBA bezpečný HTML fragment (bez <html>/<body>/<script>/<style>, bez inline style/onclick).
- Povolené tagy: h2, h3, p, ul, ol, li, strong, em, table, thead, tbody, tr, th, td, div, span, figure, details, summary, cite.
- Používaj tieto CSS triedy (appka ich štýluje):
  - div.kpi-grid > div.kpi (voliteľne .up / .down)
  - table.ai-table
  - div.callout.warning | .info | .loss | .ai
  - span.ticker data-t="TICKER"
  - figure.chart data-type="bar|line" s <script type="application/json">{"labels":[],"values":[]}</script> (JSON len v tomto tagu)
  - cite data-src="1" pre zdroje
  - details/summary pre zbaliteľné kroky
- Čísla a tickery zvýrazni <strong>. Tabuľky max 4 stĺpce na mobile.
- Nie si investičný poradca; pri odporúčaniach buď opatrný.

Kontext portfólia (JSON):
`;

export function buildAiChatSystemPrompt(ctx: AiChatBuiltContext): string {
  const gemBlock = ctx.gemInstructions
    ? `\n\nGEM INŠTRUKCIE (${ctx.gemName || "Gem"}):\n${ctx.gemInstructions}\n`
    : "";
  return (
    HTML_SYSTEM +
    JSON.stringify(ctx.summary, null, 2).slice(0, 28_000) +
    gemBlock
  );
}

export type StreamHandlers = {
  onDelta: (text: string) => void;
  signal?: AbortSignal;
};

export async function streamAiChatReply(input: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  system: string;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  if (!isClaudeFeatureEnabled("ai-chat")) {
    throw new Error(CLAUDE_DISABLED_MESSAGE);
  }

  const client = getAnthropicClient();
  let full = "";

  try {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: 4096,
        system: input.system,
        messages: input.history.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    stream.on("text", (text) => {
      full += text;
      input.onDelta(text);
    });

    await stream.finalMessage();
  } catch (err: any) {
    if (err?.name === "AbortError" || input.signal?.aborted) {
      return full;
    }
    throw new Error(formatAnthropicError(err));
  }

  return full.trim() || "<p>Nepodarilo sa zostaviť odpoveď.</p>";
}

export async function suggestChatTitle(input: {
  userMessage: string;
  assistantPreview?: string;
}): Promise<string> {
  if (!isClaudeFeatureEnabled("ai-chat")) {
    throw new Error(CLAUDE_DISABLED_MESSAGE);
  }
  const client = getAnthropicClient();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 40,
    system:
      "Navrhni krátky názov chatu (max 6 slov, slovenčina, bez úvodzoviek a bodky). Len názov.",
    messages: [
      {
        role: "user",
        content: `Otázka: ${input.userMessage.slice(0, 500)}\nNáhľad odpovede: ${(input.assistantPreview || "").slice(0, 400)}`,
      },
    ],
  });
  const block = msg.content.find((b) => b.type === "text");
  const raw =
    block && block.type === "text" ? block.text.trim() : "Nový chat";
  return raw.replace(/^["„]|["“]$/g, "").slice(0, 80) || "Nový chat";
}
