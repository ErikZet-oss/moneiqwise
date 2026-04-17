import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Banknote, TrendingUp, Calendar, DollarSign } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";

interface DividendSummary {
  totalGross: number;
  totalTax: number;
  totalNet: number;
  grossYTD: number;
  netYTD: number;
  grossThisMonth: number;
  netThisMonth: number;
  grossToday: number;
  netToday: number;
  byTicker: {
    ticker: string;
    companyName: string;
    totalGross: number;
    totalTax: number;
    totalNet: number;
    transactions: number;
  }[];
  transactionCount: number;
}

export default function Dividends() {
  const { formatCurrency } = useCurrency();
  const { getQueryParam } = usePortfolio();
  
  const portfolioParam = getQueryParam();

  const { data: dividends, isLoading } = useQuery<DividendSummary>({
    queryKey: ["/api/dividends", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/dividends?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch dividends");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const hasDividends = dividends && dividends.transactionCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Banknote className="h-6 w-6 text-primary" />
          Dividendy
        </h1>
        <p className="text-muted-foreground">Prehľad príjmov z dividend</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Dnes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500" data-testid="text-dividend-today">
              +{formatCurrency(dividends?.netToday || 0)}
            </div>
            {dividends && dividends.grossToday > 0 && dividends.grossToday > dividends.netToday && (
              <p className="text-xs text-muted-foreground">
                Hrubé: {formatCurrency(dividends.grossToday)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Tento mesiac
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500" data-testid="text-dividend-month">
              +{formatCurrency(dividends?.netThisMonth || 0)}
            </div>
            {dividends && dividends.grossThisMonth > 0 && dividends.grossThisMonth > dividends.netThisMonth && (
              <p className="text-xs text-muted-foreground">
                Hrubé: {formatCurrency(dividends.grossThisMonth)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Od začiatku roka
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500" data-testid="text-dividend-ytd">
              +{formatCurrency(dividends?.netYTD || 0)}
            </div>
            {dividends && dividends.grossYTD > 0 && dividends.grossYTD > dividends.netYTD && (
              <p className="text-xs text-muted-foreground">
                Hrubé: {formatCurrency(dividends.grossYTD)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Celkovo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500" data-testid="text-dividend-total">
              +{formatCurrency(dividends?.totalNet || 0)}
            </div>
            {dividends && dividends.totalGross > 0 && dividends.totalGross > dividends.totalNet && (
              <p className="text-xs text-muted-foreground">
                Hrubé: {formatCurrency(dividends.totalGross)} | Daň: {formatCurrency(dividends.totalTax)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dividendy podľa spoločností</CardTitle>
          <CardDescription>
            Prehľad dividend od jednotlivých spoločností
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasDividends && dividends.byTicker.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Spoločnosť</TableHead>
                  <TableHead className="text-right">Výplat</TableHead>
                  <TableHead className="text-right">Hrubé</TableHead>
                  <TableHead className="text-right">Daň</TableHead>
                  <TableHead className="text-right">Čisté</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dividends.byTicker.map((item) => (
                  <TableRow key={item.ticker} data-testid={`row-dividend-${item.ticker}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <CompanyLogo ticker={item.ticker} companyName={item.companyName} size="sm" />
                        <span className="font-medium">{item.ticker}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{item.companyName}</TableCell>
                    <TableCell className="text-right">{item.transactions}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.totalGross)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatCurrency(item.totalTax)}</TableCell>
                    <TableCell className="text-right font-medium text-blue-500">
                      +{formatCurrency(item.totalNet)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Banknote className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">Zatiaľ nemáte zaznamenané žiadne dividendy</p>
              <p className="text-sm mt-2">
                Po zadaní dividend v sekcii Transakcie tu uvidíte prehľad vašich príjmov.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {hasDividends && (
        <Card>
          <CardHeader>
            <CardTitle>Súhrn</CardTitle>
            <CardDescription>Celkový prehľad dividendových príjmov</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Celkové hrubé dividendy</p>
                <p className="text-xl font-semibold">{formatCurrency(dividends?.totalGross || 0)}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Zrazená daň</p>
                <p className="text-xl font-semibold text-red-500">-{formatCurrency(dividends?.totalTax || 0)}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Čisté dividendy</p>
                <p className="text-xl font-semibold text-blue-500">+{formatCurrency(dividends?.totalNet || 0)}</p>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t">
              <p className="text-sm text-muted-foreground">
                Celkový počet dividendových výplat: <span className="font-medium text-foreground">{dividends?.transactionCount || 0}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
