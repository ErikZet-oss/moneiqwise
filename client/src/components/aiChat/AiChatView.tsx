import { useState, type FormEvent } from "react";
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Gem,
  Globe,
  Loader2,
  Menu,
  Mic,
  Newspaper,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  Search,
  Send,
  Share2,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Download,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AiChatRichHtml } from "./AiChatRichHtml";
import { SUGGESTED_PROMPTS, GEM_COLORS, type AiChatContextFlags } from "./types";
import type { AiChatController } from "./useAiChat";

const PROMPT_ICONS = {
  chart: BarChart3,
  shield: Shield,
  news: Newspaper,
  coin: Coins,
};

function Diamond({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <Gem className={className} style={style} aria-hidden />;
}

function ToolSteps({ steps, open, streaming }: { steps: string[]; open?: boolean; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(Boolean(open));
  if (!steps.length && !streaming) return null;
  const label = streaming
    ? "Pracujem…"
    : steps.slice(0, 3).join(" · ");
  return (
    <div className="mb-2">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-2.5 py-1 text-[12px] text-[var(--rd-text-secondary)]"
        onClick={() => setExpanded((v) => !v)}
      >
        {streaming ? (
          <Loader2 className="size-3 animate-spin text-[var(--rd-ai)]" />
        ) : (
          <Check className="size-3 text-[var(--rd-profit)]" />
        )}
        <span className="max-w-[220px] truncate">{label}</span>
        <ChevronDown className={cn("size-3 transition", expanded && "rotate-180")} />
      </button>
      {expanded ? (
        <ul className="mt-2 space-y-1.5 rounded-[8px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-3 py-2">
          {steps.map((s) => (
            <li key={s} className="flex items-center gap-2 text-[12px] text-[var(--rd-text-secondary)]">
              <Check className="size-3.5 text-[var(--rd-profit)]" />
              {s}
            </li>
          ))}
          {streaming ? (
            <li className="flex items-center gap-2 text-[12px] text-[var(--rd-text-secondary)]">
              <Loader2 className="size-3.5 animate-spin text-[var(--rd-ai)]" />
              Generujem odpoveď…
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function HistoryPanel({
  c,
  className,
}: {
  c: AiChatController;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col bg-[var(--rd-bg-surface)]", className)}>
      <div className="flex items-center justify-between px-3 pt-3">
        <h2 className="text-[18px] font-bold leading-[22px]">Chaty</h2>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--rd-text-secondary)] md:hidden"
          onClick={() => c.setHistoryOpen(false)}
          aria-label="Zavrieť históriu"
        >
          <X className="size-[18px]" />
        </button>
      </div>
      <div className="px-3 pt-3">
        <label className="flex h-9 items-center gap-2 rounded-[8px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] px-3">
          <Search className="size-4 text-[var(--rd-text-tertiary)]" />
          <input
            value={c.historyQuery}
            onChange={(e) => c.setHistoryQuery(e.target.value)}
            placeholder="Hľadať v chatoch"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--rd-text-tertiary)]"
          />
        </label>
        <button
          type="button"
          className="mt-3 flex h-[38px] w-full items-center justify-center gap-2 rounded-[8px] bg-[var(--rd-ai)] text-[13px] font-semibold text-[var(--rd-text-on-brand,#03130e)]"
          onClick={() => void c.startNewChat(null)}
        >
          <Plus className="size-4" />
          Nový chat
        </button>
      </div>

      <div className="mt-4 flex-1 overflow-auto px-3 pb-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--rd-text-tertiary)]">
            Gemy
          </span>
          <button
            type="button"
            className="text-[12px] font-medium text-[var(--rd-ai)]"
            onClick={() => {
              c.setEditingGem(null);
              c.setGemFormOpen(true);
            }}
          >
            + Nový Gem
          </button>
        </div>
        <div className="mb-4 space-y-1">
          {c.gems.map((g) => (
            <button
              key={g.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1.5 text-left hover:bg-[var(--rd-bg-surface-hover)]"
              onClick={() => void c.startNewChat(g.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                c.setEditingGem(g);
                c.setGemFormOpen(true);
              }}
            >
              <span
                className="inline-flex size-6 items-center justify-center rounded-md"
                style={{ background: `${g.color}33`, color: g.color }}
              >
                <Diamond className="size-3.5" />
              </span>
              <span className="truncate text-[13px]">{g.name}</span>
            </button>
          ))}
        </div>

        {Object.entries(c.chatsByDay).map(([day, items]) => (
          <div key={day} className="mb-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--rd-text-tertiary)]">
              {day}
            </p>
            <div className="space-y-0.5">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13px] hover:bg-[var(--rd-bg-surface-hover)]",
                    c.chatId === item.id && "bg-[var(--rd-bg-surface-hover)]",
                  )}
                  onClick={() => void c.loadChat(item.id)}
                >
                  {item.gemId ? (
                    <Diamond className="size-3.5 shrink-0" style={{ color: item.gemColor || "#B48CE0" }} />
                  ) : (
                    <Sparkles className="size-3.5 shrink-0 text-[var(--rd-text-tertiary)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.pinned ? <Pin className="size-3 shrink-0 text-[var(--rd-ai)]" /> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Composer({ c }: { c: AiChatController }) {
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void c.sendMessage(c.draft);
  };
  return (
    <div className="border-t border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] px-3 pb-2 pt-2">
      <form
        onSubmit={onSubmit}
        className="rounded-[16px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-3 pb-2 pt-2.5"
      >
        <textarea
          value={c.draft}
          onChange={(e) => c.setDraft(e.target.value)}
          rows={1}
          placeholder={c.isWelcome ? "Opýtaj sa na portfólio, správy, ticker…" : "Opýtaj sa ďalej…"}
          className="max-h-28 w-full resize-none bg-transparent text-[13px] leading-[18px] outline-none placeholder:text-[var(--rd-text-tertiary)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void c.sendMessage(c.draft);
            }
          }}
        />
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            className="inline-flex size-[30px] items-center justify-center rounded-lg text-[var(--rd-text-secondary)]"
            onClick={() => c.showSoon("Príloha")}
            aria-label="Príloha"
          >
            <Paperclip className="size-4" />
          </button>
          <button
            type="button"
            className={cn(
              "inline-flex h-[30px] items-center gap-1.5 rounded-full border px-2.5 text-[12px]",
              c.activeGem
                ? "border-[var(--rd-ai)]/40 bg-[var(--rd-ai-dim)] text-[var(--rd-ai)]"
                : c.useNews
                  ? "border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]"
                  : "border-[var(--rd-border-subtle)] text-[var(--rd-text-tertiary)]",
            )}
            onClick={() => {
              if (c.activeGem) return;
              c.setUseNews(!c.useNews);
            }}
          >
            {c.activeGem ? (
              <>
                <Diamond className="size-3.5" style={{ color: c.activeGem.color }} />
                <span className="max-w-[120px] truncate">{c.activeGem.name}</span>
              </>
            ) : (
              <>
                <Globe className="size-3.5" />
                Webové správy
              </>
            )}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className="inline-flex size-[30px] items-center justify-center rounded-lg text-[var(--rd-text-secondary)]"
            onClick={() => c.showSoon("Hlasový vstup")}
            aria-label="Hlas"
          >
            <Mic className="size-4" />
          </button>
          {c.streaming ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-primary)]"
              onClick={c.stopStreaming}
              aria-label="Zastaviť"
            >
              <Square className="size-2.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!c.draft.trim()}
              className="inline-flex size-8 items-center justify-center rounded-full bg-[var(--rd-ai)] text-[var(--rd-text-on-brand,#03130e)] disabled:opacity-40"
              aria-label="Odoslať"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
      </form>
      <p className="mt-2 text-center text-[10px] text-[var(--rd-text-tertiary)]">
        AI môže robiť chyby. Nie je to investičné poradenstvo.
      </p>
    </div>
  );
}

function GemForm({ c }: { c: AiChatController }) {
  const g = c.editingGem;
  const [name, setName] = useState(g?.name || "");
  const [color, setColor] = useState(g?.color || GEM_COLORS[0]);
  const [instructions, setInstructions] = useState(g?.instructions || "");
  const [flags, setFlags] = useState<AiChatContextFlags>(
    g?.contextFlags || {
      portfolio: true,
      dividends: true,
      watchlist: true,
      news: true,
      macroAudit: true,
    },
  );
  const [starters, setStarters] = useState<string[]>(g?.starters?.length ? [...g.starters] : [""]);

  const flagRows: Array<{ key: keyof AiChatContextFlags; title: string; sub: string }> = [
    { key: "portfolio", title: "Portfólio a pozície", sub: "Hodnoty, váhy, nákupy" },
    { key: "dividends", title: "Dividendy", sub: "História a kalendár výplat" },
    { key: "watchlist", title: "Watchlist", sub: "Sledované tituly" },
    { key: "news", title: "Správy", sub: "Aktuálne články k tickerom" },
    { key: "macroAudit", title: "Posledný makro audit", sub: "Health score, riziká, akcie" },
  ];

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[var(--rd-bg-base)]">
      <header className="flex h-[54px] items-center gap-2 border-b border-[var(--rd-border-subtle)] px-3">
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-lg"
          onClick={() => {
            c.setGemFormOpen(false);
            c.setEditingGem(null);
          }}
        >
          <X className="size-[18px]" />
        </button>
        <h1 className="flex-1 text-[15px] font-semibold">{g ? "Upraviť Gem" : "Nový Gem"}</h1>
        <button
          type="button"
          className="rounded-[8px] bg-[var(--rd-ai)] px-3 py-1.5 text-[13px] font-semibold text-[var(--rd-text-on-brand,#03130e)]"
          disabled={!name.trim() || c.saveGem.isPending}
          onClick={() =>
            c.saveGem.mutate({
              id: g?.id,
              name,
              color,
              instructions,
              contextFlags: flags,
              starters: starters.filter((s) => s.trim()),
            })
          }
        >
          Uložiť
        </button>
      </header>
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex size-14 items-center justify-center rounded-2xl"
            style={{ background: `${color}33`, color }}
          >
            <Diamond className="size-8" />
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Názov Gemu"
            className="h-[58px] flex-1 rounded-[12px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-3 text-[15px] outline-none"
          />
        </div>
        <p className="mt-4 text-[12px] text-[var(--rd-text-tertiary)]">Farba</p>
        <div className="mt-2 flex gap-2">
          {GEM_COLORS.map((col) => (
            <button
              key={col}
              type="button"
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full border-2",
                color === col ? "border-white" : "border-transparent",
              )}
              style={{ background: `${col}44` }}
              onClick={() => setColor(col)}
            >
              <Diamond className="size-3.5" style={{ color: col }} />
            </button>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-[var(--rd-text-tertiary)]">Inštrukcie</p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value.slice(0, 2000))}
          rows={5}
          className="mt-2 w-full rounded-[12px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-3 text-[13px] outline-none"
        />
        <p className="mt-1 text-right text-[10px] text-[var(--rd-text-tertiary)]">
          {instructions.length} / 2000
        </p>

        <p className="mt-4 text-[12px] text-[var(--rd-text-tertiary)]">Kontext, ktorý Gem vidí</p>
        <div className="mt-2 overflow-hidden rounded-[12px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)]">
          {flagRows.map((row) => (
            <label
              key={row.key}
              className="flex items-center justify-between gap-3 border-b border-[var(--rd-border-subtle)] px-3 py-3 last:border-b-0"
            >
              <span>
                <span className="block text-[13px]">{row.title}</span>
                <span className="block text-[11px] text-[var(--rd-text-tertiary)]">{row.sub}</span>
              </span>
              <input
                type="checkbox"
                checked={flags[row.key]}
                onChange={(e) => setFlags((f) => ({ ...f, [row.key]: e.target.checked }))}
                className="size-4 accent-[var(--rd-ai)]"
              />
            </label>
          ))}
        </div>

        <p className="mt-4 text-[12px] text-[var(--rd-text-tertiary)]">
          Úvodné otázky (zobrazia sa v novom chate)
        </p>
        <div className="mt-2 space-y-2">
          {starters.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-[8px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-3 py-2">
              <input
                value={s}
                onChange={(e) =>
                  setStarters((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))
                }
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              />
              <button
                type="button"
                onClick={() => setStarters((arr) => arr.filter((_, j) => j !== i))}
              >
                <X className="size-3.5 text-[var(--rd-text-tertiary)]" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-[var(--rd-ai)]"
            onClick={() => setStarters((arr) => [...arr, ""])}
          >
            <Plus className="size-3.5" />
            Pridať otázku
          </button>
        </div>

        <button
          type="button"
          className="mt-4 flex w-full items-center gap-2 rounded-[12px] border border-dashed border-[var(--rd-border-strong)] px-3 py-3 text-left text-[12px] text-[var(--rd-text-tertiary)]"
          onClick={() => c.showSoon("Podklady")}
        >
          <Paperclip className="size-4" />
          Pridať podklady (PDF, CSV) — napr. výpis z brokera
        </button>

        {g && !g.isDefault ? (
          <button
            type="button"
            className="mt-6 w-full text-center text-[13px] text-[var(--rd-loss)]"
            onClick={() => {
              if (confirm("Zmazať tento Gem?")) c.deleteGem.mutate(g.id);
            }}
          >
            Zmazať Gem
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AiChatView({
  c,
  variant,
}: {
  c: AiChatController;
  variant: "mobile" | "desktop";
}) {
  const title = c.chat?.title || "AI Chat";

  return (
    <div
      className={cn(
        "flex bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]",
        variant === "desktop" ? "h-[calc(100vh-3rem)] min-h-[560px]" : "min-h-[calc(100dvh-72px)] flex-col",
      )}
    >
      {variant === "desktop" ? (
        <HistoryPanel c={c} className="w-[300px] shrink-0 border-r border-[var(--rd-border-subtle)]" />
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-[53px] shrink-0 items-center gap-2 border-b border-[var(--rd-border-subtle)] px-3">
          {variant === "mobile" ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg"
              onClick={() => c.setHistoryOpen(true)}
              aria-label="História"
            >
              <Menu className="size-[18px]" />
            </button>
          ) : null}
          <button
            type="button"
            className="min-w-0 flex-1 text-center"
            onClick={() => {
              if (!c.chatId) return;
              c.setRenameValue(c.chat?.title || "");
              c.setActionsOpen(true);
            }}
            onContextMenu={(e) => {
              if (!c.chatId) return;
              e.preventDefault();
              c.setRenameValue(c.chat?.title || "");
              c.setRenameOpen(true);
            }}
          >
            {c.activeGem ? (
              <span className="mx-auto flex items-center justify-center gap-1 text-[10px] text-[var(--rd-ai)]">
                <Diamond className="size-3" style={{ color: c.activeGem.color }} />
                {c.activeGem.name}
              </span>
            ) : (
              <span className="block text-[10px] text-[var(--rd-text-tertiary)]">AI</span>
            )}
            <span className="block truncate text-[15px] font-semibold leading-5">{title}</span>
          </button>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg"
            onClick={() => void c.startNewChat(c.activeGem?.id ?? null)}
            aria-label="Nový chat"
          >
            <Plus className="size-[18px]" />
          </button>
          {!c.isWelcome ? (
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg"
              onClick={() => c.showSoon("Zdieľať")}
              aria-label="Zdieľať"
            >
              <Share2 className="size-4" />
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          {c.isWelcome ? (
            <div className="px-4 pb-4 pt-6">
              <h2 className="text-[22px] font-bold leading-[26px]">Ahoj {c.greetingName}</h2>
              <p className="mt-1 text-[22px] font-bold leading-[26px] text-[var(--rd-text-secondary)]">
                Na čo sa dnes pozrieme?
              </p>
              <p className="mt-3 text-[13px] leading-[18px] text-[var(--rd-text-tertiary)]">
                Mám prístup k tvojmu portfóliu, watchlistu, správam a poslednému makro auditu.
              </p>

              <div className="mt-5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--rd-text-tertiary)]">
                  Tvoje Gemy
                </span>
                <button
                  type="button"
                  className="text-[12px] text-[var(--rd-ai)]"
                  onClick={() => c.setHistoryOpen(true)}
                >
                  Všetky
                </button>
              </div>
              <div className="mt-2 flex gap-3 overflow-x-auto pb-1">
                {c.gems.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="w-[140px] shrink-0 rounded-[12px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-3 text-left"
                    onClick={() => void c.startNewChat(g.id)}
                  >
                    <span
                      className="inline-flex size-7 items-center justify-center rounded-lg"
                      style={{ background: `${g.color}33`, color: g.color }}
                    >
                      <Diamond className="size-3.5" />
                    </span>
                    <span className="mt-2 block text-[13px] font-semibold leading-[18px]">{g.name}</span>
                    <span className="mt-1 block text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
                      {g.starters[0] || g.instructions.slice(0, 40)}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-5 text-[10px] font-semibold uppercase tracking-wide text-[var(--rd-text-tertiary)]">
                Skús sa opýtať
              </p>
              <div className="mt-2 space-y-2">
                {(c.activeGem?.starters?.length
                  ? c.activeGem.starters.map((text) => ({ icon: "chart" as const, text }))
                  : SUGGESTED_PROMPTS
                ).map((p) => {
                  const Icon = PROMPT_ICONS[p.icon] || Sparkles;
                  return (
                    <button
                      key={p.text}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-[12px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-3 py-2.5 text-left"
                      onClick={() => void c.sendMessage(p.text)}
                    >
                      <Icon className="size-4 shrink-0 text-[var(--rd-ai)]" />
                      <span className="min-w-0 flex-1 text-[13px]">{p.text}</span>
                      <ChevronRight className="size-3.5 text-[var(--rd-text-tertiary)]" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4 px-4 py-4">
              {c.messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-[16px] rounded-br-md bg-[var(--rd-bg-surface-raised)] px-3.5 py-2.5 text-[13px] leading-[18px]">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--rd-ai-dim)] text-[var(--rd-ai)]">
                        <Sparkles className="size-3.5" />
                      </span>
                    </div>
                    <ToolSteps steps={m.meta?.toolSteps || []} />
                    <AiChatRichHtml html={m.content} />
                  </div>
                ),
              )}
              {c.streaming || c.streamText ? (
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--rd-ai-dim)] text-[var(--rd-ai)]">
                      <Sparkles className="size-3.5" />
                    </span>
                  </div>
                  <ToolSteps steps={c.toolSteps} streaming open />
                  {c.streamText ? (
                    <AiChatRichHtml html={c.streamText} streaming />
                  ) : (
                    <p className="text-[13px] text-[var(--rd-text-tertiary)]">Pripravujem odpoveď…</p>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <Composer c={c} />

        {variant === "mobile" && c.historyOpen ? (
          <div className="absolute inset-0 z-40 flex bg-black/50">
            <HistoryPanel c={c} className="w-[318px] max-w-[85%]" />
            <button
              type="button"
              className="flex-1"
              aria-label="Zavrieť"
              onClick={() => c.setHistoryOpen(false)}
            />
          </div>
        ) : null}

        {c.actionsOpen ? (
          <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/50">
            <button type="button" className="flex-1" onClick={() => c.setActionsOpen(false)} />
            <div className="rounded-t-[16px] bg-[var(--rd-bg-surface)] px-4 pb-8 pt-2">
              <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--rd-border-strong)]" />
              <p className="text-[15px] font-semibold">{c.chat?.title}</p>
              <p className="text-[12px] text-[var(--rd-text-tertiary)]">
                {c.messages.length} správ
              </p>
              <div className="mt-3 space-y-1">
                <ActionBtn
                  icon={<Pencil className="size-[18px]" />}
                  label="Premenovať"
                  onClick={() => {
                    c.setActionsOpen(false);
                    c.setRenameOpen(true);
                  }}
                />
                <ActionBtn
                  icon={<Pin className="size-[18px]" />}
                  label={c.chat?.pinned ? "Odopnúť" : "Pripnúť hore"}
                  onClick={() => {
                    c.patchChat.mutate({ pinned: !c.chat?.pinned });
                    c.setActionsOpen(false);
                  }}
                />
                <ActionBtn
                  icon={<Diamond className="size-[18px] text-[var(--rd-ai)]" />}
                  label="Presunúť do Gemu…"
                  onClick={() => {
                    const first = c.gems[0];
                    if (first) c.patchChat.mutate({ gemId: first.id });
                    c.setActionsOpen(false);
                  }}
                />
                <ActionBtn
                  icon={<Share2 className="size-[18px]" />}
                  label="Zdieľať odpoveď ako obrázok"
                  onClick={() => c.showSoon("Zdieľať")}
                />
                <ActionBtn
                  icon={<Download className="size-[18px]" />}
                  label="Exportovať (Markdown)"
                  onClick={() => {
                    c.exportMarkdown();
                    c.setActionsOpen(false);
                  }}
                />
                <ActionBtn
                  icon={<Trash2 className="size-[18px] text-[var(--rd-loss)]" />}
                  label="Zmazať chat"
                  danger
                  onClick={() => {
                    if (c.chatId && confirm("Naozaj zmazať chat?")) {
                      c.deleteChat.mutate(c.chatId);
                    }
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}

        {c.renameOpen ? (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-[358px] rounded-[16px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[18px] font-bold">Premenovať chat</h3>
                <button type="button" onClick={() => c.setRenameOpen(false)}>
                  <X className="size-[18px]" />
                </button>
              </div>
              <input
                value={c.renameValue}
                onChange={(e) => c.setRenameValue(e.target.value)}
                className="mt-4 h-[48px] w-full rounded-[12px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] px-3 text-[15px] outline-none"
                autoFocus
              />
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--rd-ai)]"
                onClick={() => c.suggestTitle.mutate()}
                disabled={c.suggestTitle.isPending}
              >
                <Sparkles className="size-3" />
                Navrhnúť názov pomocou AI
              </button>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="h-9 flex-1 rounded-[8px] border border-[var(--rd-border-subtle)] text-[13px]"
                  onClick={() => c.setRenameOpen(false)}
                >
                  Zrušiť
                </button>
                <button
                  type="button"
                  className="h-9 flex-1 rounded-[8px] bg-[var(--rd-ai)] text-[13px] font-semibold text-[var(--rd-text-on-brand,#03130e)]"
                  onClick={() => {
                    c.patchChat.mutate({ title: c.renameValue });
                    c.setRenameOpen(false);
                  }}
                >
                  Uložiť
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {c.gemFormOpen ? <GemForm key={c.editingGem?.id || "new"} c={c} /> : null}
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-[42px] w-full items-center gap-3 rounded-[8px] px-1 text-left text-[13px]",
        danger && "text-[var(--rd-loss)]",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
