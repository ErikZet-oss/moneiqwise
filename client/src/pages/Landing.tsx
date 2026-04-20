import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, type FormEvent } from "react";
import { TrendingUp, BarChart3, History, PieChart, Banknote, ArrowRightLeft } from "lucide-react";

function getPasswordStrength(password: string) {
  const checks = {
    minLength: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const label = score <= 2 ? "Slabe" : score <= 3 ? "Stredne" : "Silne";
  return { checks, score, label };
}

export default function Landing() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginRememberMe, setLoginRememberMe] = useState(true);
  const [registerFirstName, setRegisterFirstName] = useState("");
  const [registerLastName, setRegisterLastName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerRememberMe, setRegisterRememberMe] = useState(true);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [devResetToken, setDevResetToken] = useState("");
  const registerStrength = getPasswordStrength(registerPassword);
  const resetStrength = getPasswordStrength(resetNewPassword);

  const refreshAuth = async () => {
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/login", {
        email: loginEmail,
        password: loginPassword,
        rememberMe: loginRememberMe,
      });
      await refreshAuth();
      toast({ title: "Prihlasenie uspesne", description: "Vitaj spat." });
    } catch (error) {
      toast({
        title: "Prihlasenie zlyhalo",
        description: error instanceof Error ? error.message : "Skontroluj email a heslo.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitRegister = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/register", {
        firstName: registerFirstName,
        lastName: registerLastName,
        email: registerEmail,
        password: registerPassword,
        rememberMe: registerRememberMe,
      });
      await refreshAuth();
      toast({ title: "Registracia uspesna", description: "Ucet bol vytvoreny a si prihlaseny." });
    } catch (error) {
      toast({
        title: "Registracia zlyhala",
        description: error instanceof Error ? error.message : "Skus to prosim znova.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitForgotPassword = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await apiRequest("POST", "/api/forgot-password", {
        email: forgotEmail,
      });
      const payload = await response.json();
      if (payload?.resetToken) {
        setDevResetToken(payload.resetToken);
        setResetEmail(forgotEmail.trim().toLowerCase());
      }
      toast({
        title: "Reset token vytvoreny",
        description: payload?.resetToken
          ? "Skopiruj token nizsie a nastav nove heslo."
          : "Ak ucet existuje, poslali sme instrukcie.",
      });
    } catch (error) {
      toast({
        title: "Zlyhalo vytvorenie reset tokenu",
        description: error instanceof Error ? error.message : "Skus to prosim znova.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await apiRequest("POST", "/api/reset-password", {
        email: resetEmail,
        token: resetToken,
        newPassword: resetNewPassword,
      });
      setDevResetToken("");
      setResetToken("");
      setResetNewPassword("");
      toast({ title: "Heslo zmenene", description: "Teraz sa mozes prihlasit novym heslom." });
    } catch (error) {
      toast({
        title: "Reset hesla zlyhal",
        description: error instanceof Error ? error.message : "Skontroluj token a skus znova.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground flex-col justify-between p-12">
        <div>
          <div className="flex items-center gap-3 mb-16">
            <div className="p-2 bg-primary rounded-lg">
              <TrendingUp className="h-8 w-8 text-primary-foreground" />
            </div>
            <span className="text-3xl font-bold">Moneiqwise</span>
          </div>
          
          <h1 className="text-4xl font-bold mb-6 leading-tight">
            Komplexný nástroj<br />
            pre správu investícií
          </h1>
          <p className="text-lg text-sidebar-foreground/70 mb-12">
            Sledujte svoje portfólio v reálnom čase. Analyzujte zisky, dividendy a výkonnosť vašich investícií.
          </p>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-sidebar-accent rounded-lg">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Prehľad portfólia</h3>
                <p className="text-sm text-sidebar-foreground/60">Celková hodnota, zisk/strata a denná zmena</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="p-2 bg-sidebar-accent rounded-lg">
                <PieChart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Analýza ziskov</h3>
                <p className="text-sm text-sidebar-foreground/60">Realizované zisky, YTD a mesačné prehľady</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="p-2 bg-sidebar-accent rounded-lg">
                <Banknote className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Sledovanie dividend</h3>
                <p className="text-sm text-sidebar-foreground/60">Hrubé, čisté dividendy a zrážková daň</p>
              </div>
            </div>
            
            <div className="flex items-start gap-4">
              <div className="p-2 bg-sidebar-accent rounded-lg">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Import/Export</h3>
                <p className="text-sm text-sidebar-foreground/60">CSV import a export všetkých transakcií</p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-sm text-sidebar-foreground/50">
          Tvoje peniaze rastú rýchlejšie ako banán.
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-12 justify-center">
            <div className="p-2 bg-primary rounded-lg">
              <TrendingUp className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="text-2xl font-bold">Moneiqwise</span>
          </div>

          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">Vitajte späť</CardTitle>
              <CardDescription>
                Prihlaste sa alebo si vytvorte lokalny ucet
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="login">Prihlasenie</TabsTrigger>
                  <TabsTrigger value="register">Registracia</TabsTrigger>
                  <TabsTrigger value="reset">Reset hesla</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <form onSubmit={submitLogin} className="space-y-3">
                    <Input
                      type="email"
                      placeholder="Email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      required
                      data-testid="input-login-email"
                    />
                    <Input
                      type="password"
                      placeholder="Heslo"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      minLength={6}
                      data-testid="input-login-password"
                    />
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="login-remember-me"
                        checked={loginRememberMe}
                        onCheckedChange={(checked) => setLoginRememberMe(checked === true)}
                      />
                      <Label htmlFor="login-remember-me">Zapamatat ma na 30 dni</Label>
                    </div>
                    <Button className="w-full" type="submit" disabled={isSubmitting} data-testid="button-login-submit">
                      {isSubmitting ? "Prihlasujem..." : "Prihlasit sa"}
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
                      data-testid="input-register-firstname"
                    />
                    <Input
                      type="text"
                      placeholder="Priezvisko (volitelne)"
                      value={registerLastName}
                      onChange={(e) => setRegisterLastName(e.target.value)}
                      data-testid="input-register-lastname"
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                      data-testid="input-register-email"
                    />
                    <Input
                      type="password"
                      placeholder="Heslo (silne)"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                      minLength={6}
                      data-testid="input-register-password"
                    />
                    <div className="text-xs text-muted-foreground">
                      Sila hesla: <span className="font-medium">{registerStrength.label}</span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1">
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
                      <Label htmlFor="register-remember-me">Zapamatat ma na 30 dni</Label>
                    </div>
                    <Button className="w-full" type="submit" disabled={isSubmitting} data-testid="button-register-submit">
                      {isSubmitting ? "Registrujem..." : "Vytvorit ucet"}
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="reset">
                  <div className="space-y-4">
                    <form onSubmit={submitForgotPassword} className="space-y-3">
                      <Label htmlFor="forgot-email">1) Vytvor reset token</Label>
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="Email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        required
                      />
                      <Button type="submit" variant="outline" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Vytvaram token..." : "Vytvorit reset token"}
                      </Button>
                    </form>

                    {devResetToken && (
                      <div className="rounded-md border p-3 bg-muted/50">
                        <p className="text-xs font-medium mb-1">Dev reset token</p>
                        <p className="text-xs break-all">{devResetToken}</p>
                      </div>
                    )}

                    <form onSubmit={submitResetPassword} className="space-y-3">
                      <Label htmlFor="reset-email">2) Nastav nove heslo</Label>
                      <Input
                        id="reset-email"
                        type="email"
                        placeholder="Email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        required
                      />
                      <Input
                        type="text"
                        placeholder="Reset token"
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value)}
                        required
                      />
                      <Input
                        type="password"
                        placeholder="Nove heslo"
                        value={resetNewPassword}
                        onChange={(e) => setResetNewPassword(e.target.value)}
                        required
                      />
                      <div className="text-xs text-muted-foreground">
                        Sila noveho hesla: <span className="font-medium">{resetStrength.label}</span>
                      </div>
                      <Button type="submit" className="w-full" disabled={isSubmitting}>
                        {isSubmitting ? "Menim heslo..." : "Zmenit heslo"}
                      </Button>
                    </form>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card className="mt-6 bg-muted/50 border-dashed">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-medium">Lokálny režim</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-xs text-muted-foreground mb-3">
                Lokalny rezim s email + heslo uctom.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <ArrowRightLeft className="h-4 w-4" />
                Po registracii sa prihlasenie vykona automaticky.
              </div>
            </CardContent>
          </Card>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <History className="h-3 w-3" />
              <span>História transakcií</span>
            </div>
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              <span>Real-time ceny</span>
            </div>
            <div className="flex items-center gap-1">
              <Banknote className="h-3 w-3" />
              <span>Dividendy</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
