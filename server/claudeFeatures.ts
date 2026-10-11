/**
 * Dočasný gate na Anthropic/Claude spotrebu.
 *
 * Default: zapnuté — Claude beží LEN pre AI Macro Audit (manuálne).
 * Obnovenie ostatných: CLAUDE_MACRO_AUDIT_ONLY=0 (alebo false/off) v env.
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
  if (feature === "macro-audit") return true;
  return !isClaudeMacroAuditOnly();
}

export const CLAUDE_DISABLED_MESSAGE =
  "Claude je dočasne vypnutý okrem AI Macro Audit (šetriace tokeny). Nastav CLAUDE_MACRO_AUDIT_ONLY=0 na serveri pre obnovu.";
