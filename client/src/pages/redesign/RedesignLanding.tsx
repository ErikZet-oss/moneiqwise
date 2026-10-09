import { ChevronDown, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Checkbox, Chip, Input } from "@/redesign/ui";
import type { LandingAuth } from "@/pages/useLandingAuth";
import { FeatureParallax } from "@/pages/redesign/FeatureParallax";

const STRENGTH_LABEL: Record<string, string> = {
  Slabe: "Slabé",
  Stredne: "Stredné",
  Silne: "Silné",
};

export function RedesignLanding({ auth }: { auth: LandingAuth }) {
  const goToAuth = (tab: "login" | "register") => {
    auth.setAuthTab(tab);
    const scroller = document.querySelector<HTMLElement>("[data-redesign-login-scroll]");
    if (!scroller) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const scrollToFeatures = () => {
    const scroller = document.querySelector<HTMLElement>("[data-redesign-login-scroll]");
    const target = document.getElementById("rd-login-features");
    if (!scroller || !target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = target.offsetTop - 12;
    scroller.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div
      data-redesign-login-scroll
      className="rd-landing h-dvh overflow-y-auto overflow-x-hidden bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]"
    >
      <Hero auth={auth} onScrollToFeatures={scrollToFeatures} />
      <section className="px-6 pb-2 pt-8">
        <h2 className="text-[22px] font-bold leading-[26px] tracking-[-0.33px]">
          Všetky investície. Jedna <span className="text-[var(--rd-profit)]">aplikácia.</span>
        </h2>
        <p className="mt-3 text-[13px] leading-[18px] text-[var(--rd-text-secondary)]">
          Portfólio, dividendy, grafy a ďalšie prehľady na jednom mieste.
        </p>
      </section>
      <FeatureParallax />
      <footer className="flex flex-col items-center gap-4 px-6 pb-12 pt-10">
        <Wordmark className="text-[22px] leading-[26px]" />
        <p className="text-[13px] leading-[18px] text-[var(--rd-text-secondary)]">Investuj múdrejšie.</p>
        <Button className="w-full" onClick={() => goToAuth("register")}>
          Vytvoriť účet
        </Button>
        <Button variant="Ghost" className="w-full" onClick={() => goToAuth("login")}>
          Už mám účet — prihlásiť sa
        </Button>
        <p className="rd-type-overline text-[var(--rd-profit)]">moneiqwise.onrender.com</p>
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
        <p className="text-[13px] leading-[18px] text-[var(--rd-text-secondary)]">Investuj múdrejšie.</p>
      </div>
      <div className="relative flex flex-col gap-4 rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-5">
        <div className="text-center">
          <h1 className="rd-type-h1">Vitajte späť</h1>
          <p className="mt-1 text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
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
        className="flex flex-col items-center gap-2 py-2 rd-type-overline text-[var(--rd-text-tertiary)]"
        onClick={onScrollToFeatures}
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
      <Button
        type="submit"
        className="w-full"
        disabled={auth.isSubmitting || auth.isPasskeySubmitting}
        data-testid="button-login-submit"
      >
        {auth.isSubmitting ? "Prihlasujem..." : "Prihlásiť sa"}
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
        {auth.isPasskeySubmitting ? "Overujem passkey..." : "Prihlásiť cez passkey"}
      </Button>
    </form>
  );
}

function RegisterForm({ auth }: { auth: LandingAuth }) {
  const checks = auth.registerStrength.checks;
  return (
    <form onSubmit={auth.submitRegister} className="flex flex-col gap-4">
      <Input
        label="Meno"
        placeholder="Meno (voliteľné)"
        value={auth.registerFirstName}
        onChange={(event) => auth.setRegisterFirstName(event.target.value)}
        data-testid="input-register-firstname"
      />
      <Input
        label="Priezvisko"
        placeholder="Priezvisko (voliteľné)"
        value={auth.registerLastName}
        onChange={(event) => auth.setRegisterLastName(event.target.value)}
        data-testid="input-register-lastname"
      />
      <Input
        label="E-mail"
        type="email"
        placeholder="Email"
        required
        value={auth.registerEmail}
        onChange={(event) => auth.setRegisterEmail(event.target.value)}
        data-testid="input-register-email"
      />
      <Input
        label="Heslo"
        type="password"
        placeholder="Heslo"
        required
        minLength={6}
        value={auth.registerPassword}
        onChange={(event) => auth.setRegisterPassword(event.target.value)}
        data-testid="input-register-password"
      />
      <p className="text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
        Sila hesla:{" "}
        <span className="font-medium text-[var(--rd-text-primary)]">
          {STRENGTH_LABEL[auth.registerStrength.label] ?? auth.registerStrength.label}
        </span>
      </p>
      <ul className="space-y-1 text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
        <li>{checks.minLength ? "✓" : "○"} aspoň 8 znakov</li>
        <li>{checks.uppercase ? "✓" : "○"} veľké písmeno</li>
        <li>{checks.lowercase ? "✓" : "○"} malé písmeno</li>
        <li>{checks.number ? "✓" : "○"} číslo</li>
        <li>{checks.symbol ? "✓" : "○"} špeciálny znak</li>
      </ul>
      <Checkbox
        id="rd-register-remember"
        checked={auth.registerRememberMe}
        onCheckedChange={auth.setRegisterRememberMe}
        label="Zapamätať ma na 30 dní"
      />
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
        <Input
          label="E-mail"
          type="email"
          placeholder="Email"
          required
          value={auth.forgotEmail}
          onChange={(event) => auth.setForgotEmail(event.target.value)}
        />
        <Button type="submit" variant="Secondary" className="w-full" disabled={auth.isSubmitting}>
          {auth.isSubmitting ? "Vytváram token..." : "Vytvoriť reset token"}
        </Button>
      </form>
      {auth.devResetToken ? (
        <div className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] p-3">
          <p className="mb-1 text-[11px] font-medium text-[var(--rd-text-secondary)]">Dev reset token</p>
          <p className="break-all font-mono text-[11px] text-[var(--rd-text-primary)]">{auth.devResetToken}</p>
        </div>
      ) : null}
      <form onSubmit={auth.submitResetPassword} className="flex flex-col gap-4">
        <Input
          label="E-mail"
          type="email"
          required
          value={auth.resetEmail}
          onChange={(event) => auth.setResetEmail(event.target.value)}
        />
        <Input
          label="Reset token"
          required
          value={auth.resetToken}
          onChange={(event) => auth.setResetToken(event.target.value)}
        />
        <Input
          label="Nové heslo"
          type="password"
          required
          value={auth.resetNewPassword}
          onChange={(event) => auth.setResetNewPassword(event.target.value)}
        />
        <p className="text-[11px] leading-[14px] text-[var(--rd-text-secondary)]">
          Sila nového hesla:{" "}
          <span className="font-medium text-[var(--rd-text-primary)]">
            {STRENGTH_LABEL[auth.resetStrength.label] ?? auth.resetStrength.label}
          </span>
        </p>
        <Button type="submit" className="w-full" disabled={auth.isSubmitting}>
          {auth.isSubmitting ? "Mením heslo..." : "Zmeniť heslo"}
        </Button>
      </form>
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
