import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, BarChart3, History, PieChart, Banknote, ArrowRightLeft, LogIn } from "lucide-react";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-sidebar text-sidebar-foreground flex-col justify-between p-12">
        <div>
          <div className="flex items-center gap-3 mb-16">
            <div className="p-2 bg-primary rounded-lg">
              <TrendingUp className="h-8 w-8 text-primary-foreground" />
            </div>
            <span className="text-3xl font-bold">PortfólioTracker</span>
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
            <span className="text-2xl font-bold">PortfólioTracker</span>
          </div>

          <Card className="border-0 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl">Vitajte späť</CardTitle>
              <CardDescription>
                Prihláste sa do svojho účtu a pokračujte v sledovaní investícií
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <Button 
                className="w-full h-12 text-base gap-3"
                data-testid="button-login"
                onClick={handleLogin}
              >
                <LogIn className="h-5 w-5" />
                Pokračovať do aplikácie
              </Button>

              <div className="pt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Nemáte účet?{" "}
                  <button 
                    className="text-primary hover:underline font-medium"
                    data-testid="button-signup"
                    onClick={handleLogin}
                  >
                    Zaregistrujte sa zadarmo
                  </button>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-6 bg-muted/50 border-dashed">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm font-medium">Lokálny režim</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-xs text-muted-foreground mb-3">
                Aplikácia beží lokálne bez externého Replit prihlásenia.
              </p>
              <Button 
                variant="outline" 
                size="sm"
                className="w-full"
                data-testid="button-login-local"
                onClick={handleLogin}
              >
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Vstúpiť ako lokálny používateľ
              </Button>
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
