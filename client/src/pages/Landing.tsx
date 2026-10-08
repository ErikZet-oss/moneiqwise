import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMemo, useId } from "react";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import { MobileUiToggle } from "@/redesign/MobileUiToggle";
import { RedesignLanding } from "@/pages/redesign/RedesignLanding";
import { useLandingAuth } from "@/pages/useLandingAuth";
import {
  TrendingUp,
  BarChart3,
  PieChart,
  Banknote,
  ArrowRightLeft,
  LineChart,
  CalendarClock,
  Target,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

const LANDING_BENEFITS: { Icon: LucideIcon; title: string; description: string }[] = [
  {
    Icon: BarChart3,
    title: "Prehľad portfólia",
    description: "Celková hodnota, zisk/strata a denná zmena",
  },
  {
    Icon: PieChart,
    title: "Analýza ziskov",
    description: "Realizované zisky, YTD a mesačné prehľady",
  },
  {
    Icon: Banknote,
    title: "Sledovanie dividend",
    description: "Hrubé, čisté dividendy a zrážková daň",
  },
  {
    Icon: ArrowRightLeft,
    title: "Import/Export",
    description: "CSV import a export všetkých transakcií",
  },
  {
    Icon: LineChart,
    title: "Pokročilé grafy výkonu",
    description: "Porovnanie portfólia vs. S&P 500 a vývoj v čase",
  },
  {
    Icon: CalendarClock,
    title: "Trhový kalendár udalostí",
    description: "Earnings, dividendy a makro dáta s preklikom na detaily",
  },
  {
    Icon: Target,
    title: "Opcie a daňový asistent",
    description: "Sledovanie opcií, realizovaného zisku a ročných prehľadov",
  },
];

/** Soft rising green stroke — one full-page layer so it never seams. */
function LandingAmbientLine() {
  const uid = useId().replace(/:/g, "");
  const strokeId = `landingAmbientStroke-${uid}`;
  const fillId = `landingAmbientFill-${uid}`;
  const glowId = `landingAmbientGlow-${uid}`;
  const path = useMemo(() => {
    const w = 1600;
    const h = 900;
    const pts: string[] = [];
    for (let i = 0; i <= 64; i++) {
      const t = i / 64;
      const x = t * w;
      const wave = Math.sin(t * Math.PI * 1.85) * 52 + Math.sin(t * Math.PI * 4.2) * 18;
      const y = h * 0.58 - t * h * 0.22 + wave;
      pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  }, []);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1600 900"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={strokeId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(160 70% 52%)" stopOpacity="0" />
          <stop offset="12%" stopColor="hsl(160 70% 52%)" stopOpacity="0.35" />
          <stop offset="50%" stopColor="hsl(160 78% 58%)" stopOpacity="0.75" />
          <stop offset="88%" stopColor="hsl(160 70% 52%)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(160 70% 52%)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={fillId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="hsl(160 70% 52%)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="hsl(160 70% 52%)" stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-5%" y="-50%" width="110%" height="200%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={`${path} L 1600 900 L 0 900 Z`} fill={`url(#${fillId})`} />
      <path
        d={path}
        fill="none"
        stroke={`url(#${strokeId})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${glowId})`}
        opacity="0.85"
        className="blur-[0.6px]"
      />
    </svg>
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
    return (
      <>
        <MobileUiToggle pinned variant="redesign" />
        <RedesignLanding auth={auth} />
      </>
    );
  }

  return (
    <div className="landing-page min-h-screen relative overflow-hidden bg-[#08090b] text-white">
      <div className="absolute inset-0 landing-fade-grid" aria-hidden />
      <div className="absolute inset-0 opacity-70" aria-hidden>
        <LandingAmbientLine />
      </div>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_15%_20%,hsl(160_40%_22%_/_0.2),transparent_55%),radial-gradient(ellipse_55%_45%_at_88%_70%,hsl(200_45%_28%_/_0.14),transparent_50%)]"
        aria-hidden
      />

      <div className="absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-[max(10px,env(safe-area-inset-top))]">
        <MobileUiToggle variant="classic" />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 xl:p-14">
          <div>
            <div className="flex items-center gap-3 mb-16">
              <div className="p-2 bg-primary rounded-lg">
                <TrendingUp className="h-8 w-8 text-primary-foreground" />
              </div>
              <span className="text-3xl font-bold">Moneiqwise</span>
            </div>

            <h1 className="text-4xl font-bold mb-6 leading-tight">
              Komplexný nástroj
              <br />
              pre správu investícií
            </h1>
            <p className="text-lg text-white/65 mb-12 max-w-md">
              Sledujte svoje portfólio v reálnom čase. Analyzujte zisky, dividendy a výkonnosť vašich
              investícií.
            </p>

            <div className="space-y-6">
              {LANDING_BENEFITS.map(({ Icon, title, description }) => (
                <div key={title} className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-white/5 ring-1 ring-white/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">{title}</h3>
                    <p className="text-sm text-white/50">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-start items-stretch px-4 pt-6 pb-12 sm:px-6 sm:pb-14 lg:items-center lg:justify-center lg:py-10 lg:px-8">
          <div className="w-full max-w-md mx-auto">
            <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
              <div className="p-2 bg-primary rounded-lg">
                <TrendingUp className="h-6 w-6 text-primary-foreground" />
              </div>
              <span className="text-2xl font-bold tracking-tight">Moneiqwise</span>
            </div>

            <Card className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-white/[0.06] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_60px_-20px_rgba(0,0,0,0.65),0_0_48px_-12px_rgba(52,211,153,0.28)] backdrop-blur-xl">
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/50 to-transparent"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -top-24 left-1/2 h-40 w-56 -translate-x-1/2 rounded-full bg-emerald-400/15 blur-3xl"
                aria-hidden
              />
              <CardHeader className="relative text-center pb-2 pt-7">
                <CardTitle className="text-2xl tracking-tight text-white">Vitajte späť</CardTitle>
                <CardDescription className="text-white/55">
                  Prihláste sa alebo si vytvorte účet
                </CardDescription>
              </CardHeader>
              <CardContent className="relative space-y-4 pt-4 pb-7">
              <Tabs value={authTab} onValueChange={setAuthTab} className="w-full">
                <TabsList className="grid h-auto w-full grid-cols-3 gap-0.5 rounded-xl border border-white/10 bg-black/30 p-1 sm:gap-1">
                  <TabsTrigger
                    value="login"
                    className="rounded-lg px-1.5 py-2 text-[11px] leading-tight data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:px-3 sm:py-1.5 sm:text-sm sm:leading-normal"
                  >
                    Prihlásenie
                  </TabsTrigger>
                  <TabsTrigger
                    value="register"
                    className="rounded-lg px-1.5 py-2 text-[11px] leading-tight data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:px-3 sm:py-1.5 sm:text-sm sm:leading-normal"
                  >
                    Registrácia
                  </TabsTrigger>
                  <TabsTrigger
                    value="reset"
                    className="rounded-lg px-1.5 py-2 text-[11px] leading-tight data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-100 data-[state=active]:shadow-none sm:px-3 sm:py-1.5 sm:text-sm sm:leading-normal"
                  >
                    Reset hesla
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={submitLogin} className="space-y-3">
                    <Input
                      type="email"
                      placeholder="Email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                      className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      data-testid="input-login-email"
                    />
                    <Input
                      type="password"
                      placeholder="Heslo"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      minLength={6}
                      className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      data-testid="input-login-password"
                    />
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="login-remember-me"
                        checked={loginRememberMe}
                        onCheckedChange={(checked) => setLoginRememberMe(checked === true)}
                      />
                      <Label htmlFor="login-remember-me" className="text-white/70">
                        Zapamatat ma na 30 dni
                      </Label>
                    </div>
                    <Button
                      className="w-full h-11 text-sm font-semibold shadow-[0_0_24px_-4px_rgba(52,211,153,0.55)]"
                      type="submit"
                      disabled={isSubmitting || isPasskeySubmitting}
                      data-testid="button-login-submit"
                    >
                      {isSubmitting ? "Prihlasujem..." : "Prihlasit sa"}
                    </Button>
                    <div className="relative py-1">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-white/10" />
                      </div>
                      <div className="relative flex justify-center text-[11px] uppercase tracking-wide text-white/45">
                        <span className="bg-transparent px-2">alebo</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-11 border-white/15 bg-transparent text-white hover:bg-white/5"
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

                <TabsContent value="register">
                  <form onSubmit={submitRegister} className="space-y-3">
                    <Input
                      type="text"
                      placeholder="Meno (volitelne)"
                      value={registerFirstName}
                      onChange={(e) => setRegisterFirstName(e.target.value)}
                      className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      data-testid="input-register-firstname"
                    />
                    <Input
                      type="text"
                      placeholder="Priezvisko (volitelne)"
                      value={registerLastName}
                      onChange={(e) => setRegisterLastName(e.target.value)}
                      className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      data-testid="input-register-lastname"
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                      className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      data-testid="input-register-email"
                    />
                    <Input
                      type="password"
                      placeholder="Heslo (silne)"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                      minLength={6}
                      className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      data-testid="input-register-password"
                    />
                    <div className="text-xs text-white/50">
                      Sila hesla: <span className="font-medium text-white/80">{registerStrength.label}</span>
                    </div>
                    <ul className="text-xs text-white/45 space-y-1">
                      <li>{registerStrength.checks.minLength ? "✓" : "○"} aspon 8 znakov</li>
                      <li>{registerStrength.checks.uppercase ? "✓" : "○"} velke pismeno</li>
                      <li>{registerStrength.checks.lowercase ? "✓" : "○"} male pismeno</li>
                      <li>{registerStrength.checks.number ? "✓" : "○"} cislo</li>
                      <li>{registerStrength.checks.symbol ? "✓" : "○"} specialny znak</li>
                    </ul>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="register-remember-me"
                        checked={registerRememberMe}
                        onCheckedChange={(checked) => setRegisterRememberMe(checked === true)}
                      />
                      <Label htmlFor="register-remember-me" className="text-white/70">
                        Zapamatat ma na 30 dni
                      </Label>
                    </div>
                    <Button
                      className="w-full h-11 text-sm font-semibold shadow-[0_0_24px_-4px_rgba(52,211,153,0.55)]"
                      type="submit"
                      disabled={isSubmitting}
                      data-testid="button-register-submit"
                    >
                      {isSubmitting ? "Registrujem..." : "Vytvorit ucet"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="reset">
                  <div className="space-y-4">
                    <form onSubmit={submitForgotPassword} className="space-y-3">
                      <Label htmlFor="forgot-email" className="text-white/70">
                        1) Vytvor reset token
                      </Label>
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="Email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        required
                        className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        className="w-full h-11 border-white/15 bg-transparent text-white hover:bg-white/5"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Vytvaram token..." : "Vytvorit reset token"}
                      </Button>
                    </form>

                    {devResetToken && (
                      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <p className="text-xs font-medium mb-1 text-white/80">Dev reset token</p>
                        <p className="text-xs break-all text-white/55">{devResetToken}</p>
                      </div>
                    )}

                    <form onSubmit={submitResetPassword} className="space-y-3">
                      <Label htmlFor="reset-email" className="text-white/70">
                        2) Nastav nove heslo
                      </Label>
                      <Input
                        id="reset-email"
                        type="email"
                        placeholder="Email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        required
                        className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      />
                      <Input
                        type="text"
                        placeholder="Reset token"
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value)}
                        required
                        className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      />
                      <Input
                        type="password"
                        placeholder="Nove heslo"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        required
                        className="h-11 border-white/10 bg-black/25 text-white placeholder:text-white/35 focus-visible:ring-emerald-400/40"
                      />
                      <div className="text-xs text-white/50">
                        Sila noveho hesla:{" "}
                        <span className="font-medium text-white/80">{resetStrength.label}</span>
                      </div>
                      <Button
                        type="submit"
                        className="w-full h-11 text-sm font-semibold shadow-[0_0_24px_-4px_rgba(52,211,153,0.55)]"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Menim heslo..." : "Zmenit heslo"}
                      </Button>
                    </form>
                  </div>
                </TabsContent>
              </Tabs>
              </CardContent>
            </Card>

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
    </div>
  );
}