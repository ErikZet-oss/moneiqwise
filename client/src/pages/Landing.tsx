import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import { RedesignLanding } from "@/pages/redesign/RedesignLanding";
import { useLandingAuth } from "@/pages/useLandingAuth";
import {
  LandingFeatureShowcase,
  LandingScrollCue,
  type LandingFeature,
} from "@/pages/LandingFeatureShowcase";
import { cn } from "@/lib/utils";
import {
  Home,
  TrendingUp,
  CircleDollarSign,
  Upload,
  LineChart,
  CalendarDays,
  ChartCandlestick,
  KeyRound,
  Check,
  X,
} from "lucide-react";

const LANDING_BENEFITS: LandingFeature[] = [
  {
    Icon: Home,
    title: "Prehľad portfólia",
    description: "Celková hodnota, zisk/strata a denná zmena",
    img: "/login/feature-1-prehlad.png",
  },
  {
    Icon: TrendingUp,
    title: "Analýza ziskov",
    description: "Realizované zisky, YTD a mesačné prehľady",
    img: "/login/feature-2-zisk.png",
  },
  {
    Icon: CircleDollarSign,
    title: "Sledovanie dividend",
    description: "Hrubé, čisté dividendy a zrážková daň",
    img: "/login/feature-3-dividendy.png",
  },
  {
    Icon: Upload,
    title: "Import/Export",
    description: "CSV import a export všetkých transakcií",
    img: "/login/feature-4-historia.png",
  },
  {
    Icon: LineChart,
    title: "Pokročilé grafy výkonu",
    description: "Porovnanie portfólia vs. S&P 500 a vývoj v čase",
    img: "/login/feature-5-grafy.png",
  },
  {
    Icon: CalendarDays,
    title: "Trhový kalendár udalostí",
    description: "Earnings, dividendy a makro dáta s preklikom na detaily",
    img: "/login/feature-6-kalendar.png",
  },
  {
    Icon: ChartCandlestick,
    title: "Opcie a daňový asistent",
    description: "Sledovanie opcií, realizovaného zisku a ročných prehľadov",
    img: "/login/feature-7-dane.png",
  },
];

const STRENGTH_LABEL: Record<string, string> = {
  Slabe: "Slabé",
  Stredne: "Stredné",
  Silne: "Silné",
};

const inputClass =
  "h-10 rounded-lg border-white/10 bg-[#0d0f12] text-[13px] text-white placeholder:text-white/35 focus-visible:ring-primary/40";
const labelClass = "text-[11px] font-medium text-white/60";
const tabClass =
  "rounded-full px-1.5 py-2 text-[11px] leading-tight text-white/55 data-[state=active]:bg-white/[0.08] data-[state=active]:text-white data-[state=active]:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] sm:px-3 sm:py-1.5 sm:text-[12px] sm:leading-normal";

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-[-0.03em] text-white", className)}>
      Mone<span className="text-primary">IQ</span>Wise
    </span>
  );
}

function StrengthMeter({ label, score, caption }: { label: string; score: number; caption: string }) {
  const filled = score <= 2 ? 1 : score === 3 ? 2 : score === 4 ? 3 : 4;
  const tone = label === "Silne" ? "bg-primary" : label === "Stredne" ? "bg-amber-400" : "bg-rose-400";
  const toneText = label === "Silne" ? "text-primary" : label === "Stredne" ? "text-amber-400" : "text-rose-400";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-white/50">{caption}</span>
        <span className={cn("font-medium", toneText)}>{STRENGTH_LABEL[label] ?? label}</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 rounded-full", i < filled ? tone : "bg-white/10")} />
        ))}
      </div>
    </div>
  );
}

export default function Landing() {
  const redesign = useMobileRedesign();
  const auth = useLandingAuth();
  const {
    isSubmitting,
    isPasskeySubmitting,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginRememberMe,
    setLoginRememberMe,
    registerFirstName,
    setRegisterFirstName,
    registerLastName,
    setRegisterLastName,
    registerEmail,
    setRegisterEmail,
    registerPassword,
    setRegisterPassword,
    registerRememberMe,
    setRegisterRememberMe,
    forgotEmail,
    setForgotEmail,
    resetEmail,
    setResetEmail,
    resetToken,
    setResetToken,
    resetNewPassword,
    setResetNewPassword,
    devResetToken,
    authTab,
    setAuthTab,
    registerStrength,
    resetStrength,
    submitLogin,
    submitPasskeyLogin,
    submitRegister,
    submitForgotPassword,
    submitResetPassword,
  } = auth;

  if (redesign) {
    return <RedesignLanding auth={auth} />;
  }

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollToFeatures = () => {
    document
      .getElementById("landing-features")
      ?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  };
  const goToAuth = (tab: "login" | "register") => {
    setAuthTab(tab);
    window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
  };

  const registerChecks: { ok: boolean; label: string }[] = [
    { ok: registerStrength.checks.minLength, label: "aspoň 8 znakov" },
    { ok: registerStrength.checks.uppercase, label: "veľké písmeno" },
    { ok: registerStrength.checks.lowercase, label: "malé písmeno" },
    { ok: registerStrength.checks.number, label: "číslo" },
    { ok: registerStrength.checks.symbol, label: "špeciálny znak" },
  ];

  return (
    <div className="landing-page min-h-screen relative overflow-hidden bg-[#08090b] text-white">
      <div
        className="pointer-events-none absolute left-[-180px] top-[-220px] h-[560px] w-[760px] rounded-full bg-[radial-gradient(ellipse_at_center,hsl(166_65%_32%_/_0.42),transparent_68%)] blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute right-[20px] top-[500px] h-[420px] w-[520px] rounded-full bg-[radial-gradient(ellipse_at_center,hsl(166_65%_30%_/_0.22),transparent_70%)] blur-2xl"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-screen lg:mx-auto lg:max-w-[1200px] lg:items-center lg:gap-16 lg:px-10">
        <div className="hidden lg:flex lg:flex-1 flex-col min-w-0">
          <Wordmark className="text-[40px] leading-[44px]" />
          <p className="mt-[18px] text-[13px] text-white/55">Investuj múdrejšie.</p>
          <h1 className="mt-[18px] text-[32px] font-bold leading-[38px] tracking-[-0.02em]">
            Komplexný nástroj
            <br />
            pre správu investícií
          </h1>
          <p className="mt-[18px] text-[13px] text-white/60">
            Sledujte svoje portfólio v reálnom čase. Analyzujte zisky, dividendy a výkonnosť vašich investícií.
          </p>

          <ul className="mt-5 space-y-2.5">
            {LANDING_BENEFITS.map(({ Icon, title, description }) => (
              <li key={title} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[13px] font-semibold leading-4">{title}</h3>
                  <p className="text-[11px] leading-[14px] text-white/45">{description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex-1 flex flex-col justify-start items-stretch px-4 pt-6 pb-12 sm:px-6 sm:pb-14 lg:flex-none lg:w-[440px] lg:items-center lg:justify-center lg:px-0 lg:py-10">
          <div className="w-full max-w-md mx-auto lg:max-w-none">
            <div className="lg:hidden flex items-center mb-8 justify-center">
              <Wordmark className="text-[28px] leading-8" />
            </div>

            <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#1d2126] to-[#16191d] p-7 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]">
              <div className="text-center">
                <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-white">Vitajte späť</h2>
                <p className="mt-0.5 text-[11px] text-white/45">Prihláste sa alebo si vytvorte účet</p>
              </div>
              <Tabs value={authTab} onValueChange={setAuthTab} className="mt-4 w-full">
                <TabsList className="grid h-auto w-full grid-cols-3 gap-0.5 rounded-full border border-white/10 bg-[#0a0b0d] p-1">
                  <TabsTrigger value="login" className={tabClass}>
                    Prihlásenie
                  </TabsTrigger>
                  <TabsTrigger value="register" className={tabClass}>
                    Registrácia
                  </TabsTrigger>
                  <TabsTrigger value="reset" className={tabClass}>
                    Reset hesla
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-4">
                  <form onSubmit={submitLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-email" className={labelClass}>
                        E-mail
                      </Label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="Email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                        className={inputClass}
                        data-testid="input-login-email"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="login-password" className={labelClass}>
                        Heslo
                      </Label>
                      <Input
                        id="login-password"
                        type="password"
                        placeholder="Heslo"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        minLength={6}
                        className={inputClass}
                        data-testid="input-login-password"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="login-remember-me"
                        checked={loginRememberMe}
                        onCheckedChange={(checked) => setLoginRememberMe(checked === true)}
                      />
                      <Label htmlFor="login-remember-me" className="text-[12px] font-normal text-white/80">
                        Zapamätať ma na 30 dní
                      </Label>
                    </div>
                    <Button
                      className="w-full h-10 text-[13px] font-semibold"
                      type="submit"
                      disabled={isSubmitting || isPasskeySubmitting}
                      data-testid="button-login-submit"
                    >
                      {isSubmitting ? "Prihlasujem..." : "Prihlásiť sa"}
                    </Button>
                    <div className="flex items-center gap-3">
                      <span className="h-px flex-1 bg-white/10" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.8px] text-white/40">alebo</span>
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10 border-white/12 bg-white/[0.03] text-[13px] text-white hover:bg-white/[0.06]"
                      onClick={submitPasskeyLogin}
                      disabled={isSubmitting || isPasskeySubmitting}
                      data-testid="button-login-passkey"
                    >
                      {isPasskeySubmitting ? (
                        "Overujem passkey..."
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <KeyRound className="h-4 w-4" />
                          Prihlásiť cez passkey
                        </span>
                      )}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register" className="mt-4">
                  <form onSubmit={submitRegister} className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5 min-w-0">
                        <Label htmlFor="register-firstname" className={labelClass}>
                          Meno (voliteľné)
                        </Label>
                        <Input
                          id="register-firstname"
                          type="text"
                          placeholder="Meno"
                          value={registerFirstName}
                          onChange={(e) => setRegisterFirstName(e.target.value)}
                          className={inputClass}
                          data-testid="input-register-firstname"
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <Label htmlFor="register-lastname" className={labelClass}>
                          Priezvisko (voliteľné)
                        </Label>
                        <Input
                          id="register-lastname"
                          type="text"
                          placeholder="Priezvisko"
                          value={registerLastName}
                          onChange={(e) => setRegisterLastName(e.target.value)}
                          className={inputClass}
                          data-testid="input-register-lastname"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="register-email" className={labelClass}>
                        E-mail
                      </Label>
                      <Input
                        id="register-email"
                        type="email"
                        placeholder="Email"
                        value={registerEmail}
                        onChange={(e) => setRegisterEmail(e.target.value)}
                        required
                        className={inputClass}
                        data-testid="input-register-email"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="register-password" className={labelClass}>
                        Heslo
                      </Label>
                      <Input
                        id="register-password"
                        type="password"
                        placeholder="Heslo (silné)"
                        value={registerPassword}
                        onChange={(e) => setRegisterPassword(e.target.value)}
                        required
                        minLength={6}
                        className={inputClass}
                        data-testid="input-register-password"
                      />
                    </div>
                    <StrengthMeter label={registerStrength.label} score={registerStrength.score} caption="Sila hesla:" />
                    <ul className="flex flex-wrap gap-1.5">
                      {registerChecks.map(({ ok, label }) => (
                        <li
                          key={label}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                            ok ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 text-white/50",
                          )}
                        >
                          {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                          {label}
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="register-remember-me"
                        checked={registerRememberMe}
                        onCheckedChange={(checked) => setRegisterRememberMe(checked === true)}
                      />
                      <Label htmlFor="register-remember-me" className="text-[12px] font-normal text-white/80">
                        Zapamätať ma na 30 dní
                      </Label>
                    </div>
                    <Button
                      className="w-full h-10 text-[13px] font-semibold"
                      type="submit"
                      disabled={isSubmitting}
                      data-testid="button-register-submit"
                    >
                      {isSubmitting ? "Registrujem..." : "Vytvoriť účet"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="reset" className="mt-4">
                  <div className="space-y-4">
                    <form onSubmit={submitForgotPassword} className="space-y-3">
                      <p className="text-[13px] font-semibold text-white">1) Vytvor reset token</p>
                      <div className="space-y-1.5">
                        <Label htmlFor="forgot-email" className={labelClass}>
                          E-mail
                        </Label>
                        <Input
                          id="forgot-email"
                          type="email"
                          placeholder="Email"
                          value={forgotEmail}
                          onChange={(e) => setForgotEmail(e.target.value)}
                          required
                          className={inputClass}
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="outline"
                        className="w-full h-10 border-white/12 bg-white/[0.03] text-[13px] text-white hover:bg-white/[0.06]"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Vytváram token..." : "Vytvoriť reset token"}
                      </Button>
                    </form>

                    {devResetToken && (
                      <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                        <p className="text-xs font-medium mb-1 text-white/80">Dev reset token</p>
                        <p className="text-xs break-all text-white/55">{devResetToken}</p>
                      </div>
                    )}

                    <div className="h-px bg-white/10" />

                    <form onSubmit={submitResetPassword} className="space-y-3">
                      <p className="text-[13px] font-semibold text-white">2) Nastav nové heslo</p>
                      <div className="space-y-1.5">
                        <Label htmlFor="reset-email" className={labelClass}>
                          E-mail
                        </Label>
                        <Input
                          id="reset-email"
                          type="email"
                          placeholder="Email"
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          required
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reset-token" className={labelClass}>
                          Reset token
                        </Label>
                        <Input
                          id="reset-token"
                          type="text"
                          placeholder="Reset token"
                          value={resetToken}
                          onChange={(e) => setResetToken(e.target.value)}
                          required
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reset-new-password" className={labelClass}>
                          Nové heslo
                        </Label>
                        <Input
                          id="reset-new-password"
                          type="password"
                          placeholder="Nové heslo"
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                          required
                          className={inputClass}
                        />
                      </div>
                      <StrengthMeter label={resetStrength.label} score={resetStrength.score} caption="Sila nového hesla:" />
                      <Button
                        type="submit"
                        className="w-full h-10 text-[13px] font-semibold"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Mením heslo..." : "Zmeniť heslo"}
                      </Button>
                    </form>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="lg:hidden mt-10 w-full">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm">
                <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3.5">
                  <h2 className="text-base font-semibold leading-snug">Čo v aplikácii nájdeš</h2>
                  <p className="mt-1 text-xs text-white/50 leading-relaxed">
                    Portfólio, dividendy, grafy a ďalšie prehľady na jednom mieste.
                  </p>
                </div>
                <ul className="divide-y divide-white/10">
                  {LANDING_BENEFITS.map(({ Icon, title, description }) => (
                    <li key={title} className="flex gap-3 px-4 py-3.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                        <Icon className="h-[18px] w-[18px] text-primary" />
                      </div>
                      <div className="min-w-0 pt-0.5">
                        <p className="text-sm font-medium leading-snug">{title}</p>
                        <p className="mt-0.5 text-xs text-white/50 leading-relaxed">{description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 hidden lg:block">
        <div className="-mt-20 flex justify-center">
          <LandingScrollCue onClick={scrollToFeatures} />
        </div>
        <LandingFeatureShowcase features={LANDING_BENEFITS} />
        <footer className="relative flex flex-col items-center gap-3 px-6 py-[110px] text-center">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,hsl(166_65%_30%_/_0.2),transparent_70%)]"
            aria-hidden
          />
          <Wordmark className="relative text-[32px] leading-9" />
          <p className="relative text-[17px] font-semibold text-white/60">Investuj múdrejšie. Začni ešte dnes.</p>
          <div className="relative mt-2 flex items-center gap-3">
            <Button className="h-10 px-4 text-[13px] font-semibold" onClick={() => goToAuth("login")}>
              Prihlásiť sa
            </Button>
            <Button
              variant="outline"
              className="h-10 border-white/12 bg-white/[0.03] px-4 text-[13px] text-white hover:bg-white/[0.06]"
              onClick={() => goToAuth("register")}
            >
              Vytvoriť účet
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
