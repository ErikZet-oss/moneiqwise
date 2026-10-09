import { useEffect, useRef } from "react";
import { ChevronDown, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Chip, Input } from "@/redesign/ui";
import type { LandingAuth } from "@/pages/useLandingAuth";

/**
 * Feature sections for the long-scroll login.
 * Motion follows Figma frame "Login â€” parallax: fĂˇzy a ĹˇpecifikĂˇcia":
 * progress 0â†’1 as the section moves from viewport bottom to vertical center;
 * odd phones +160â†’0 (from right), even â’160â†’0 (from left); Y +40â†’0;
 * phone opacity 0.4â†’1; text fades in during progress 0â†’0.5; glow at scrollĂ—0.3.
 */
const FEATURES: {
  index: string;
  title: string;
  body: string;
  side: "left" | "right";
  image: string;
}[] = [
  {
    index: "01 / 07",
    title: "PrehÄľad portfĂłlia",
    body: "CelkovĂˇ hodnota, zisk/strata a dennĂˇ zmena",
    side: "right",
    image: "/landing/overview.png",
  },
  {
    index: "02 / 07",
    title: "AnalĂ˝za ziskov",
    body: "RealizovanĂ© zisky, YTD a mesaÄŤnĂ© prehÄľady",
    side: "left",
    image: "/landing/profit.png",
  },
  {
    index: "03 / 07",
    title: "Sledovanie dividend",
    body: "HrubĂ©, ÄŤistĂ© dividendy a zrĂˇĹľkovĂˇ daĹ",
    side: "right",
    image: "/landing/dividends.png",
  },
  {
    index: "04 / 07",
    title: "Import/Export",
    body: "CSV import a export vĹˇetkĂ˝ch transakciĂ­",
    side: "left",
    image: "/landing/history.png",
  },
  {
    index: "05 / 07",
    title: "PokroÄŤilĂ© grafy vĂ˝konu",
    body: "Porovnanie portfĂłlia vs. S&P 500 a vĂ˝voj v ÄŤase",
    side: "right",
    image: "/landing/charts.png",
  },
  {
    index: "06 / 07",
    title: "TrhovĂ˝ kalendĂˇr udalostĂ­",
    body: "Earnings, dividendy a makro dĂˇta s preklikom na detaily",
    side: "left",
    image: "/landing/calendar.png",
  },
  {
    index: "07 / 07",
    title: "Opcie a daĹovĂ˝ asistent",
    body: "Sledovanie opciĂ­, realizovanĂ©ho zisku a roÄŤnĂ˝ch prehÄľadov",
    side: "right",
    image: "/landing/tax.png",
  },
];

const STRENGTH_LABEL: Record<string, string> = {
  Slabe: "SlabĂ©",
  Stredne: "StrednĂ©",
  Silne: "SilnĂ©",
};

/** Phone frame size from Figma; ~35% stays past the screen edge when settled. */
const PHONE_W = 211;
const PHONE_H = 440;
const PHONE_OVERHANG = Math.round(PHONE_W * 0.35);
const PHONE_SLIDE_X = 160;
const PHONE_SLIDE_Y = 40;
const TEXT_SLIDE_Y = 24;

export function RedesignLanding({ auth }: { auth: LandingAuth }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const update = () => {
      frame = 0;
      const reduce = reduceQuery.matches;
      const view = scroller.getBoundingClientRect();
      scroller.querySelectorAll<HTMLElement>("[data-parallax-section]").forEach((section) => {
        applySectionParallax(section, view, reduce);
      });
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    reduceQuery.addEventListener("change", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      reduceQuery.removeEventListener("change", onScroll);
    };
  }, []);

  const goToAuth = (tab: "login" | "register") => {
    auth.setAuthTab(tab);
    const scroller = scrollRef.current;
    if (!scroller) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const scrollToFeatures = () => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>("#rd-login-features");
    if (!scroller || !target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = target.offsetTop - 12;
    scroller.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div
      ref={scrollRef}
      data-redesign-login-scroll
      className="rd-landing h-dvh overflow-y-auto bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]"
    >
      {/* Auth card stays fixed in document flow â€” not part of parallax (Figma). */}
      <Hero auth={auth} onScrollToFeatures={scrollToFeatures} />
      <section id="rd-login-features" className="px-6 pb-2 pt-8">
        <h2 className="rd-type-display-lg">
          VĹˇetky investĂ­cie. Jedna <span className="text-[var(--rd-profit)]">aplikĂˇcia.</span>
        </h2>
        <p className="mt-3 text-sm leading-5 text-[var(--rd-text-secondary)]">
          PortfĂłlio, dividendy, grafy a ÄŹalĹˇie prehÄľady na jednom mieste.
        </p>
      </section>
      {FEATURES.map((feature) => (
        <FeatureSection key={feature.index} feature={feature} />
      ))}
      <footer className="flex flex-col items-center gap-4 px-6 pb-12 pt-10">
        <Wordmark className="rd-type-display-lg" />
        <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">Investuj mĂşdrejĹˇie.</p>
        <Button className="w-full" onClick={() => goToAuth("register")}>
          VytvoriĹĄ ĂşÄŤet
        </Button>
        <Button variant="Ghost" className="w-full" onClick={() => goToAuth("login")}>
          UĹľ mĂˇm ĂşÄŤet â€” prihlĂˇsiĹĄ sa
        </Button>
        <p className="rd-type-overline text-[var(--rd-profit)]">
          moneiqwise.onrender.com
        </p>
      </footer>
    </div>
  );
}

function Hero({
  auth,
  onScrollToFeatures,
}: {
  auth: LandingAuth;
  onScrollToFeatures: () => void;
}) {
  return (
    <section className="relative flex flex-col gap-6 px-4 pb-8 pt-16">
      <div
        aria-hidden
        className="pointer-events-none absolute left-4 top-[-40px] size-[280px] rounded-full bg-[var(--rd-profit)]/20 blur-3xl"
      />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <Wordmark className="text-[40px] leading-[44px]" />
        <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">Investuj mĂşdrejĹˇie.</p>
      </div>
      <div className="relative flex flex-col gap-4 rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-5">
        <div className="text-center">
          <h1 className="rd-type-h1">Vitajte spĂ¤ĹĄ</h1>
          <p className="mt-1 text-xs leading-4 text-[var(--rd-text-secondary)]">
            PrihlĂˇste sa alebo si vytvorte ĂşÄŤet
          </p>
        </div>
        <div className="flex items-center justify-between rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] p-1">
          <Chip active={auth.authTab === "login"} className="flex-1" onClick={() => auth.setAuthTab("login")}>
            PrihlĂˇsenie
          </Chip>
          <Chip active={auth.authTab === "register"} className="flex-1" onClick={() => auth.setAuthTab("register")}>
            RegistrĂˇcia
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
        className="flex flex-col items-center gap-2 py-2 rd-type-overline text-[var(--rd-text-tertiary)]"
        onClick={onScrollToFeatures}
      >
        ÄŚo v aplikĂˇcii nĂˇjdeĹˇ
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
        label="ZapamĂ¤taĹĄ ma na 30 dnĂ­"
      />
      <Button type="submit" className="w-full" disabled={auth.isSubmitting || auth.isPasskeySubmitting} data-testid="button-login-submit">
        {auth.isSubmitting ? "Prihlasujem..." : "PrihlĂˇsiĹĄ sa"}
      </Button>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--rd-border-subtle)]" />
        <span className="rd-type-overline text-[var(--rd-text-tertiary)]">alebo</span>
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
        {auth.isPasskeySubmitting ? "Overujem passkey..." : "PrihlĂˇsiĹĄ cez passkey"}
      </Button>
    </form>
  );
}

function RegisterForm({ auth }: { auth: LandingAuth }) {
  const checks = auth.registerStrength.checks;
  return (
    <form onSubmit={auth.submitRegister} className="flex flex-col gap-4">
      <Input label="Meno" placeholder="Meno (voliteÄľnĂ©)" value={auth.registerFirstName} onChange={(event) => auth.setRegisterFirstName(event.target.value)} data-testid="input-register-firstname" />
      <Input label="Priezvisko" placeholder="Priezvisko (voliteÄľnĂ©)" value={auth.registerLastName} onChange={(event) => auth.setRegisterLastName(event.target.value)} data-testid="input-register-lastname" />
      <Input label="E-mail" type="email" placeholder="Email" required value={auth.registerEmail} onChange={(event) => auth.setRegisterEmail(event.target.value)} data-testid="input-register-email" />
      <Input label="Heslo" type="password" placeholder="Heslo" required minLength={6} value={auth.registerPassword} onChange={(event) => auth.setRegisterPassword(event.target.value)} data-testid="input-register-password" />
      <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
        Sila hesla: <span className="font-medium text-[var(--rd-text-primary)]">{STRENGTH_LABEL[auth.registerStrength.label] ?? auth.registerStrength.label}</span>
      </p>
      <ul className="space-y-1 text-xs leading-4 text-[var(--rd-text-tertiary)]">
        <li>{checks.minLength ? "âś“" : "â—‹"} aspoĹ 8 znakov</li>
        <li>{checks.uppercase ? "âś“" : "â—‹"} veÄľkĂ© pĂ­smeno</li>
        <li>{checks.lowercase ? "âś“" : "â—‹"} malĂ© pĂ­smeno</li>
        <li>{checks.number ? "âś“" : "â—‹"} ÄŤĂ­slo</li>
        <li>{checks.symbol ? "âś“" : "â—‹"} ĹˇpeciĂˇlny znak</li>
      </ul>
      <Checkbox id="rd-register-remember" checked={auth.registerRememberMe} onCheckedChange={auth.setRegisterRememberMe} label="ZapamĂ¤taĹĄ ma na 30 dnĂ­" />
      <Button type="submit" className="w-full" disabled={auth.isSubmitting} data-testid="button-register-submit">
        {auth.isSubmitting ? "Registrujem..." : "VytvoriĹĄ ĂşÄŤet"}
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
          {auth.isSubmitting ? "VytvĂˇram token..." : "VytvoriĹĄ reset token"}
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
        <Input label="NovĂ© heslo" type="password" required value={auth.resetNewPassword} onChange={(event) => auth.setResetNewPassword(event.target.value)} />
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Sila novĂ©ho hesla: <span className="font-medium text-[var(--rd-text-primary)]">{STRENGTH_LABEL[auth.resetStrength.label] ?? auth.resetStrength.label}</span>
        </p>
        <Button type="submit" className="w-full" disabled={auth.isSubmitting}>
          {auth.isSubmitting ? "MenĂ­m heslo..." : "ZmeniĹĄ heslo"}
        </Button>
      </form>
    </div>
  );
}

/**
 * Motion from Figma "Login â€” parallax: fĂˇzy a ĹˇpecifikĂˇcia".
 * progress 0 at section top = viewport bottom; 1 when section is vertically centered.
 * prefers-reduced-motion: no transforms, only opacity fade when near viewport.
 */
function applySectionParallax(section: HTMLElement, view: DOMRect, reduce: boolean) {
  const rect = section.getBoundingClientRect();
  const start = view.bottom;
  const end = view.top + view.height / 2 - rect.height / 2;
  const raw = (start - rect.top) / (start - end || 1);
  const progress = Math.min(1, Math.max(0, raw));
  const fromX = Number(section.dataset.fromX || 0);
  // Distance the section has traveled into the viewport (for glow depth).
  const traveled = Math.max(0, Math.min(view.height + rect.height, view.bottom - rect.top));

  const phone = section.querySelector<HTMLElement>("[data-parallax-phone]");
  if (phone) {
    if (reduce) {
      phone.style.transform = "translate3d(0, 0, 0)";
      phone.style.opacity = progress > 0.15 ? "1" : "0";
    } else {
      const x = fromX * (1 - progress);
      const y = PHONE_SLIDE_Y * (1 - progress);
      phone.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      phone.style.opacity = String(0.4 + 0.6 * progress);
    }
  }

  const text = section.querySelector<HTMLElement>("[data-parallax-text]");
  if (text) {
    if (reduce) {
      text.style.transform = "translate3d(0, 0, 0)";
      text.style.opacity = progress > 0.15 ? "1" : "0";
    } else {
      // Text finishes in the first half of the phone motion so it reads earlier.
      const textProgress = Math.min(1, progress / 0.5);
      const y = TEXT_SLIDE_Y * (1 - textProgress);
      text.style.transform = `translate3d(0, ${y}px, 0)`;
      text.style.opacity = String(textProgress);
    }
  }

  const glow = section.querySelector<HTMLElement>("[data-parallax-glow]");
  if (glow) {
    // Slower than content: translateY = scroll Ă— 0.3
    const y = reduce ? 0 : traveled * 0.3;
    glow.style.transform = `translate3d(0, ${y}px, 0)`;
  }
}

function FeatureSection({ feature }: { feature: (typeof FEATURES)[number] }) {
  const fromRight = feature.side === "right";
  const fromX = fromRight ? PHONE_SLIDE_X : -PHONE_SLIDE_X;

  return (
    <section
      data-parallax-section
      data-from-x={fromX}
      className="relative h-[560px] overflow-hidden"
    >
      <div
        data-parallax-glow
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[140px] size-[280px] rounded-full bg-[var(--rd-profit)]/30 blur-3xl will-change-transform",
          fromRight ? "right-[-120px]" : "left-[-120px]",
        )}
        style={{ transform: "translate3d(0, 0, 0)" }}
      />
      {/* Phone chrome matches Figma: 211Ă—440, radius 34, notch, ~35% overhang. */}
      <div
        data-parallax-phone
        className="pointer-events-none absolute top-[60px] will-change-transform"
        style={{
          width: PHONE_W,
          height: PHONE_H,
          ...(fromRight ? { right: -PHONE_OVERHANG } : { left: -PHONE_OVERHANG }),
          transform: `translate3d(${fromX}px, ${PHONE_SLIDE_Y}px, 0)`,
          opacity: 0.4,
        }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[34px] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-base)] shadow-[0_24px_48px_rgba(0,0,0,0.45)]">
          <div
            aria-hidden
            className="absolute left-1/2 top-[5px] z-10 h-[6px] w-[56px] -translate-x-1/2 rounded-[3px] bg-[var(--rd-bg-surface-hover)]"
          />
          <img
            src={feature.image}
            alt=""
            width={195}
            height={426}
            decoding="async"
            loading="lazy"
            className="absolute inset-x-2 top-[14px] h-[calc(100%-14px)] w-[calc(100%-16px)] rounded-t-[26px] object-cover object-top"
          />
        </div>
      </div>
      <div
        data-parallax-text
        className={cn(
          "absolute top-[190px] w-[196px] will-change-transform",
          fromRight ? "left-6" : "right-4",
        )}
        style={{ transform: `translate3d(0, ${TEXT_SLIDE_Y}px, 0)`, opacity: 0 }}
      >
        <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{feature.index}</p>
        <h3 className="mt-3 rd-type-h1">{feature.title}</h3>
        <p className="mt-3 text-sm leading-5 text-[var(--rd-text-secondary)]">{feature.body}</p>
      </div>
    </section>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <p className={cn("font-bold tracking-[-0.03em] text-[var(--rd-text-primary)]", className)}>
      Mone<span className="text-[var(--rd-profit)]">IQ</span>Wise
    </p>
  );
}
