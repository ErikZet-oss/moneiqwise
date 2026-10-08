import { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Chip, Input } from "@/redesign/ui";
import type { LandingAuth } from "@/pages/useLandingAuth";

const FEATURES: {
  index: string;
  title: string;
  body: string;
  side: "left" | "right";
  kind: "overview" | "profit" | "dividends" | "import" | "charts" | "calendar" | "tax";
}[] = [
  {
    index: "01 / 07",
    title: "Prehľad portfólia",
    body: "Celková hodnota, zisk/strata a denná zmena",
    side: "right",
    kind: "overview",
  },
  {
    index: "02 / 07",
    title: "Analýza ziskov",
    body: "Realizované zisky, YTD a mesačné prehľady",
    side: "left",
    kind: "profit",
  },
  {
    index: "03 / 07",
    title: "Sledovanie dividend",
    body: "Hrubé, čisté dividendy a zrážková daň",
    side: "right",
    kind: "dividends",
  },
  {
    index: "04 / 07",
    title: "Import/Export",
    body: "CSV import a export všetkých transakcií",
    side: "left",
    kind: "import",
  },
  {
    index: "05 / 07",
    title: "Pokročilé grafy výkonu",
    body: "Porovnanie portfólia vs. S&P 500 a vývoj v čase",
    side: "right",
    kind: "charts",
  },
  {
    index: "06 / 07",
    title: "Trhový kalendár udalostí",
    body: "Earnings, dividendy a makro dáta s preklikom na detaily",
    side: "left",
    kind: "calendar",
  },
  {
    index: "07 / 07",
    title: "Opcie a daňový asistent",
    body: "Sledovanie opcií, realizovaného zisku a ročných prehľadov",
    side: "right",
    kind: "tax",
  },
];

const STRENGTH_LABEL: Record<string, string> = {
  Slabe: "Slabé",
  Stredne: "Stredné",
  Silne: "Silné",
};

export function RedesignLanding({ auth }: { auth: LandingAuth }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const goToAuth = (tab: "login" | "register") => {
    auth.setAuthTab(tab);
    const scroller = scrollRef.current;
    if (!scroller) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div
      ref={scrollRef}
      data-redesign-login-scroll
      className="h-dvh overflow-y-auto bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]"
    >
      <Hero auth={auth} />
      <section className="px-6 pb-2 pt-8">
        <h2 className="text-[34px] font-bold leading-[38px] tracking-[-0.02em]">
          Všetky investície. Jedna <span className="text-[var(--rd-profit)]">aplikácia.</span>
        </h2>
        <p className="mt-3 text-sm leading-5 text-[var(--rd-text-secondary)]">
          Portfólio, dividendy, grafy a ďalšie prehľady na jednom mieste.
        </p>
      </section>
      {FEATURES.map((feature) => (
        <FeatureSection key={feature.index} {...feature} />
      ))}
      <footer className="flex flex-col items-center gap-4 px-6 pb-12 pt-10">
        <Wordmark className="text-[34px] leading-[38px]" />
        <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">Investuj múdrejšie.</p>
        <Button className="w-full" onClick={() => goToAuth("register")}>
          Vytvoriť účet
        </Button>
        <Button variant="Ghost" className="w-full" onClick={() => goToAuth("login")}>
          Už mám účet — prihlásiť sa
        </Button>
        <p className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-[var(--rd-profit)]">
          moneiqwise.onrender.com
        </p>
      </footer>
    </div>
  );
}

function Hero({ auth }: { auth: LandingAuth }) {
  const heroRef = useRef<HTMLElement>(null);
  const [glow, setGlow] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return;
    const scroller = heroRef.current?.closest("[data-redesign-login-scroll]");
    const onScroll = () => {
      const top = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
      setGlow(top * 0.3);
    };
    onScroll();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller?.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section ref={heroRef} className="relative flex flex-col gap-6 px-4 pb-8 pt-16">
      <div
        aria-hidden
        className="pointer-events-none absolute left-4 top-[-40px] size-[280px] rounded-full bg-[var(--rd-profit)]/20 blur-3xl"
        style={{ transform: `translate3d(0, ${glow}px, 0)` }}
      />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <Wordmark className="text-[40px] leading-[44px]" />
        <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">Investuj múdrejšie.</p>
      </div>
      <div className="relative flex flex-col gap-4 rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-5">
        <div className="text-center">
          <h1 className="text-[22px] font-bold leading-7 tracking-[-0.01em]">Vitajte späť</h1>
          <p className="mt-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            Prihláste sa alebo si vytvorte účet
          </p>
        </div>
        <div className="flex items-center justify-between rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] p-1">
          <Chip active={auth.authTab === "login"} className="flex-1" onClick={() => auth.setAuthTab("login")}>
            Prihlásenie
          </Chip>
          <Chip active={auth.authTab === "register"} className="flex-1" onClick={() => auth.setAuthTab("register")}>
            Registrácia
          </Chip>
          <Chip active={auth.authTab === "reset"} className="flex-1" onClick={() => auth.setAuthTab("reset")}>
            Reset hesla
          </Chip>
        </div>
        {auth.authTab === "login" ? <LoginForm auth={auth} /> : null}
        {auth.authTab === "register" ? <RegisterForm auth={auth} /> : null}
        {auth.authTab === "reset" ? <ResetForm auth={auth} /> : null}
      </div>
      <button
        type="button"
        className="flex flex-col items-center gap-2 py-2 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-[var(--rd-text-tertiary)]"
        onClick={() => {
          const scroller = heroRef.current?.closest("[data-redesign-login-scroll]");
          const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (scroller instanceof HTMLElement) {
            scroller.scrollTo({ top: 760, behavior: reduce ? "auto" : "smooth" });
          }
        }}
      >
        Čo v aplikácii nájdeš
        <ChevronDown className="size-5" aria-hidden />
      </button>
    </section>
  );
}

function LoginForm({ auth }: { auth: LandingAuth }) {
  return (
    <form onSubmit={auth.submitLogin} className="flex flex-col gap-4">
      <Input
        label="E-mail"
        type="email"
        placeholder="Email"
        value={auth.loginEmail}
        onChange={(event) => auth.setLoginEmail(event.target.value)}
        required
        data-testid="input-login-email"
      />
      <Input
        label="Heslo"
        type="password"
        placeholder="Heslo"
        value={auth.loginPassword}
        onChange={(event) => auth.setLoginPassword(event.target.value)}
        required
        minLength={6}
        data-testid="input-login-password"
      />
      <Checkbox
        id="rd-login-remember"
        checked={auth.loginRememberMe}
        onCheckedChange={auth.setLoginRememberMe}
        label="Zapamätať ma na 30 dní"
      />
      <Button type="submit" className="w-full" disabled={auth.isSubmitting || auth.isPasskeySubmitting} data-testid="button-login-submit">
        {auth.isSubmitting ? "Prihlasujem..." : "Prihlásiť sa"}
      </Button>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--rd-border-subtle)]" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--rd-text-tertiary)]">alebo</span>
        <span className="h-px flex-1 bg-[var(--rd-border-subtle)]" />
      </div>
      <Button
        type="button"
        variant="Secondary"
        className="w-full"
        onClick={() => void auth.submitPasskeyLogin()}
        disabled={auth.isSubmitting || auth.isPasskeySubmitting}
        data-testid="button-login-passkey"
      >
        <KeyRound className="size-[18px]" />
        {auth.isPasskeySubmitting ? "Overujem passkey..." : "Prihlásiť cez passkey"}
      </Button>
    </form>
  );
}

function RegisterForm({ auth }: { auth: LandingAuth }) {
  const checks = auth.registerStrength.checks;
  return (
    <form onSubmit={auth.submitRegister} className="flex flex-col gap-4">
      <Input label="Meno" placeholder="Meno (voliteľné)" value={auth.registerFirstName} onChange={(event) => auth.setRegisterFirstName(event.target.value)} data-testid="input-register-firstname" />
      <Input label="Priezvisko" placeholder="Priezvisko (voliteľné)" value={auth.registerLastName} onChange={(event) => auth.setRegisterLastName(event.target.value)} data-testid="input-register-lastname" />
      <Input label="E-mail" type="email" placeholder="Email" required value={auth.registerEmail} onChange={(event) => auth.setRegisterEmail(event.target.value)} data-testid="input-register-email" />
      <Input label="Heslo" type="password" placeholder="Heslo" required minLength={6} value={auth.registerPassword} onChange={(event) => auth.setRegisterPassword(event.target.value)} data-testid="input-register-password" />
      <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
        Sila hesla: <span className="font-medium text-[var(--rd-text-primary)]">{STRENGTH_LABEL[auth.registerStrength.label] ?? auth.registerStrength.label}</span>
      </p>
      <ul className="space-y-1 text-xs leading-4 text-[var(--rd-text-tertiary)]">
        <li>{checks.minLength ? "✓" : "○"} aspoň 8 znakov</li>
        <li>{checks.uppercase ? "✓" : "○"} veľké písmeno</li>
        <li>{checks.lowercase ? "✓" : "○"} malé písmeno</li>
        <li>{checks.number ? "✓" : "○"} číslo</li>
        <li>{checks.symbol ? "✓" : "○"} špeciálny znak</li>
      </ul>
      <Checkbox id="rd-register-remember" checked={auth.registerRememberMe} onCheckedChange={auth.setRegisterRememberMe} label="Zapamätať ma na 30 dní" />
      <Button type="submit" className="w-full" disabled={auth.isSubmitting} data-testid="button-register-submit">
        {auth.isSubmitting ? "Registrujem..." : "Vytvoriť účet"}
      </Button>
    </form>
  );
}

function ResetForm({ auth }: { auth: LandingAuth }) {
  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={auth.submitForgotPassword} className="flex flex-col gap-4">
        <Input label="E-mail" type="email" placeholder="Email" required value={auth.forgotEmail} onChange={(event) => auth.setForgotEmail(event.target.value)} />
        <Button type="submit" variant="Secondary" className="w-full" disabled={auth.isSubmitting}>
          {auth.isSubmitting ? "Vytváram token..." : "Vytvoriť reset token"}
        </Button>
      </form>
      {auth.devResetToken ? (
        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] p-3">
          <p className="mb-1 text-xs font-medium text-[var(--rd-text-secondary)]">Dev reset token</p>
          <p className="break-all font-mono text-xs text-[var(--rd-text-primary)]">{auth.devResetToken}</p>
        </div>
      ) : null}
      <form onSubmit={auth.submitResetPassword} className="flex flex-col gap-4">
        <Input label="E-mail" type="email" required value={auth.resetEmail} onChange={(event) => auth.setResetEmail(event.target.value)} />
        <Input label="Reset token" required value={auth.resetToken} onChange={(event) => auth.setResetToken(event.target.value)} />
        <Input label="Nové heslo" type="password" required value={auth.resetNewPassword} onChange={(event) => auth.setResetNewPassword(event.target.value)} />
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Sila nového hesla: <span className="font-medium text-[var(--rd-text-primary)]">{STRENGTH_LABEL[auth.resetStrength.label] ?? auth.resetStrength.label}</span>
        </p>
        <Button type="submit" className="w-full" disabled={auth.isSubmitting}>
          {auth.isSubmitting ? "Mením heslo..." : "Zmeniť heslo"}
        </Button>
      </form>
    </div>
  );
}

function FeatureSection({
  index,
  title,
  body,
  side,
  kind,
}: (typeof FEATURES)[number]) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const [glow, setGlow] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShown(true);
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    const scroller = el.closest("[data-redesign-login-scroll]");
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const parent = scroller instanceof HTMLElement ? scroller.getBoundingClientRect() : null;
      const viewTop = parent?.top ?? 0;
      const viewHeight = parent?.height ?? window.innerHeight;
      const delta = rect.top + rect.height / 2 - (viewTop + viewHeight / 2);
      setGlow(delta * 0.3);
    };
    onScroll();
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <section ref={ref} className="relative h-[560px] overflow-hidden">
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[140px] size-[280px] rounded-full bg-[var(--rd-profit)]/25 blur-3xl",
          side === "right" ? "right-[-80px]" : "left-[-80px]",
        )}
        style={{ transform: `translate3d(0, ${glow}px, 0)` }}
      />
      <div
        className={cn(
          "rd-phone-slide absolute top-[60px] w-[211px] transition-transform duration-700 ease-out",
          side === "right" ? "right-[-28px]" : "left-[-28px]",
          !shown && (side === "right" ? "translate-x-[180px]" : "-translate-x-[180px]"),
        )}
      >
        <PhoneMock kind={kind} title={title} />
      </div>
      <div
        className={cn(
          "absolute top-[190px] w-[196px]",
          side === "right" ? "left-6" : "right-6 text-right",
        )}
      >
        <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{index}</p>
        <h3 className="mt-3 text-[22px] font-bold leading-7 tracking-[-0.01em]">{title}</h3>
        <p className="mt-3 text-sm leading-5 text-[var(--rd-text-secondary)]">{body}</p>
      </div>
    </section>
  );
}

function PhoneMock({ kind, title }: { kind: (typeof FEATURES)[number]["kind"]; title: string }) {
  return (
    <div className="h-[440px] overflow-hidden rounded-[28px] border border-[var(--rd-border-strong)] bg-[#050607] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.8)]">
      <div className="mx-auto mt-2 h-1.5 w-14 rounded-full bg-[var(--rd-bg-surface-hover)]" />
      <div className="px-3 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--rd-text-tertiary)]">MoneIQWise</p>
        <p className="text-sm font-semibold leading-5">{title}</p>
        <div className="mt-3 space-y-2">
          <MockBody kind={kind} />
        </div>
      </div>
    </div>
  );
}

function MockBody({ kind }: { kind: (typeof FEATURES)[number]["kind"] }) {
  if (kind === "overview") {
    return (
      <>
        <MockStat label="Hodnota" value="37 143 €" tone="text-[var(--rd-text-primary)]" />
        <MockStat label="Profit" value="+19 854 €" tone="text-[var(--rd-profit)]" />
        <MockBars />
      </>
    );
  }
  if (kind === "profit") return <MockStat label="YTD" value="+12,4 %" tone="text-[var(--rd-profit)]" />;
  if (kind === "dividends") return <MockStat label="Dividendy" value="842 €" tone="text-[var(--rd-profit)]" />;
  if (kind === "import") return <MockStat label="Import" value="XTB · CSV" tone="text-[var(--rd-text-primary)]" />;
  if (kind === "charts") return <MockBars />;
  if (kind === "calendar") return <MockStat label="Najbližšie" value="Earnings" tone="text-[var(--rd-info)]" />;
  return <MockStat label="Daň" value="Ročný súčet" tone="text-[var(--rd-warning)]" />;
}

function MockStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-2">
      <p className="text-[9px] uppercase tracking-[0.08em] text-[var(--rd-text-tertiary)]">{label}</p>
      <p className={cn("font-mono text-sm font-medium", tone)}>{value}</p>
    </div>
  );
}

function MockBars() {
  return (
    <div className="flex h-16 items-end gap-1 rounded-[10px] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-2">
      {[40, 55, 48, 70, 62, 80, 74].map((height) => (
        <span key={height} className="flex-1 rounded-sm bg-[var(--rd-profit)]/80" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <p className={cn("font-bold tracking-[-0.03em] text-[var(--rd-text-primary)]", className)}>
      Mone<span className="text-[var(--rd-profit)]">IQ</span>Wise
    </p>
  );
}
