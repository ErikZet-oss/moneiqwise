/**
 * Dočasný gate na Anthropic/Claude spotrebu.
 *
 * Default: zapnuté — Claude beží pre AI Macro Audit + AI Chat.
 * Ostatné (bot, alerts, scanner, paper): CLAUDE_MACRO_AUDIT_ONLY=0.
 */
export function isClaudeMacroAuditOnly(): boolean {
  const raw = process.env.CLAUDE_MACRO_AUDIT_ONLY?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  // Bez env → dočasne ON (šetrí tokeny).
  return true;
}

export type ClaudeFeature =
  | "macro-audit"
  | "ai-bot"
  | "ai-alerts"
  | "ai-scanner"
  | "ai-chat"
  | "paper-bot-ai";

export function isClaudeFeatureEnabled(feature: ClaudeFeature): boolean {
  // Primárne Claude sekcie — vždy povolené (Macro Audit + AI Chat).
  if (feature === "macro-audit" || feature === "ai-chat") return true;
  return !isClaudeMacroAuditOnly();
}

export const CLAUDE_DISABLED_MESSAGE =
  "Claude je dočasne vypnutý okrem AI Macro Audit a AI Chat (šetriace tokeny). Nastav CLAUDE_MACRO_AUDIT_ONLY=0 na serveri pre obnovu.";
