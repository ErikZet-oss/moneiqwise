import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-sm bg-muted/60 border border-border/80 p-3 rounded-md overflow-x-auto my-3 text-foreground">
      {children}
    </div>
  );
}

export default function FaqPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-faq-title">
          FAQ — ako Moneiqwise funguje
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          Metodika výpočtov, dáta, import a pojmy. Text je informatívny; pri daňových a právnych záležitostiach sa spoľahni na odborníka.
        </p>
      </div>

      <div className="prose prose-sm dark:prose-invert max-w-none space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>1. Metodika výpočtov</CardTitle>
            <CardDescription>
              Aplikácia nie je len jednoduchá kalkulačka — zohľadňuje čas peňažných tokov, FIFO náklady a meny.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-foreground leading-relaxed">
            <section>
              <h3 className="text-base font-semibold mb-2">Ako sa počíta výkonnosť portfólia (TWR)?</h3>
              <p>
                Pre reťazenú výkonnosť používame prístup zarovnateľný s princípmi{" "}
                <strong>Time-Weighted Return (TWR)</strong> v duchu{" "}
                <strong>GIPS</strong> (Global Investment Performance Standards): výnos sa má odrážať od rozhodnutí a trhov, nie od toho, či si práve vložil alebo vybral hotovosť.
              </p>
              <p className="mt-2">
                Pre jednotlivé <strong>sub-periódy</strong> (po obdobiach medzi významnými peňažnými tokmi) sa často používa tvar základu, kde sa end-of-day hodnota porovná s hodnotou po zohľadnení tokov:
              </p>
              <Formula>
                r<sub>n</sub> = (EV − (BV + CF)) / (BV + CF)
              </Formula>
              <p className="text-muted-foreground text-xs">
                <strong>BV</strong> — hodnota na začiatku sub-periódy, <strong>CF</strong> — čisté vklady/výbery (spravidla vážené podľa času v období v plnej GIPS metodike),{" "}
                <strong>EV</strong> — hodnota na konci. Výsledné <strong>r<sub>n</sub></strong> očisťuje vývoj portfólia od „náhodného“ efektu, že práve v ten deň prišiel veľký vklad alebo výber.
              </p>
              <p className="mt-3">
                <strong>V našej implementácii</strong> delíme časovú os na <strong>segmenty</strong> medzi dátumami vkladov a výberov a medzi prvou udalosťou a dneškom. V každom segmente pracujeme s{" "}
                <strong>ohmatateľnou trhovou hodnotou (MTM) pozícií plus kumulovaná hotovosť</strong> v tvojom zobrazenom meny — podobne ako na Prehľade. Segmentové pomery sa <strong>reťazia</strong> (násobia{" "}
                <code>(1 + r)</code>), aby výsledok nezávisel od toho, či si hotovosť pridal skôr alebo neskôr v rámci rovnakého trhového vývoja.
              </p>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Čo je FIFO a ako ovplyvňuje zisk?</h3>
              <p>
                <strong>FIFO (First-In, First-Out)</strong> znamená, že pri predaji sa najprv „spotrebujú“ najstaršie nakúpené kusy — presne v poradí nákupov.
              </p>
              <p className="mt-2">
                <strong>Príklad:</strong> Ak si kúpil 1 akciu za 100 € a neskôr ďalšiu 1 akciu za 120 €, pri predaji <strong>jedného</strong> kusu sa za náklad považuje <strong>100 €</strong> (prvá do radu). Zvyšok portfólia má stále druhý lot po 120 €.
              </p>
              <p className="mt-2">
                Realizovaný zisk z predaja sa počíta oproti týmto FIFO nákladom (v EUR v deň transakcie — pozri FX nižšie). Nerealizovaný zisk otvorených pozícií vychádza z aktuálnych cien oproti zostávajúcim lotom.
              </p>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Ako sa počíta celková hodnota (Total Value)?</h3>
              <Formula>
                Celková hodnota ≈ súčet (aktuálna cena × počet kusov) po tituloch + hotovosť / margin
              </Formula>
              <p>
                „Akcie“ môžu zahŕňať aj odhad hodnoty otvorených opcií (prémie), ak máš v celku zapnuté portfóliá s opciami. Hotovosť je <strong>disponibilná EUR</strong> zúčtovaná z vkladov, výberov, obchodov, dividend, daní a pod. — nie len súčet vkladov.
              </p>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Ako riešime menové konverzie (FX)?</h3>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong>Historicky pri transakcii:</strong> nákup/predaj v USD (a iných menách) sa prepočítava do EUR (a do meny zobrazenia) kurzom platným pri <strong>dátume transakcie</strong> — z uloženého kurzu v zázname, z EUR ekvivalentu, alebo z doplneného ECB kurzu (Frankfurter) pre daný deň. Tak sa snažíme, aby hotovosť a FIFO náklady sedeli s realitou obchodu.
                </li>
                <li>
                  <strong>Aktuálna hodnota:</strong> dnešné ceny titulov sa berú v ich obchodnej mene a na Prehľade sa prepočítavajú do zvolenej meny používateľa <strong>aktuálnymi</strong> kurzami zobrazenia.
                </li>
              </ul>
              <p className="mt-2 text-muted-foreground text-xs">
                Preto môže byť drobný rozdiel oproti brokerovi, ktorý používa iný zdroj kurzu alebo iné zaokrúhľovanie.
              </p>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Spracovanie dát a import</CardTitle>
            <CardDescription>Hotovosť, úroky, dividendy a súbory z brokera.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-foreground leading-relaxed">
            <section>
              <h3 className="text-base font-semibold mb-2">Prečo mi nesedí hotovosť o pár eur?</h3>
              <p>
                Úprimne: <strong>zaokrúhľovanie</strong> (napr. na 2 desatinné miesta v importe aj v prepočtoch), <strong>odlišný kurz</strong> medzi brokerom a naším dátovým zdrojom (ECB / Frankfurter) a rôzne zaokrúhľovacie pravidlá u brokera môžu dať rozdiel v rádoch jednotiek až desiatok eur pri veľkom objeme transakcií. Ak je rozdiel systematicky väčší, skontroluj import a chýbajúce riadky (vklady, poplatky, dividendy).
              </p>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Započítavajú sa do zisku aj úroky z hotovosti?</h3>
              <p>
                <strong>Áno.</strong> Položky <strong>Úrok z cash XTB</strong> (v dátach ticker <code>CASH_INTEREST</code>, úrok z free cash z importu XTB) sa evidujú ako peňažné toky zvyšujúce hotovosť. Zvyšujú celkovú hodnotu portfólia a tým aj celkový výnos (P&amp;L) v čase, keď sú pripísané — rovnako ako iné cash toky, ktoré zvyšujú disponibilnú sumu.
              </p>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Čo sa deje s dividendami?</h3>
              <p>
                Dividendy evidujeme ako transakcie; <strong>čistá suma</strong> po zrážke (pole provízia / daň podľa zápisu) zvyčajne <strong>zvýši hotovosť</strong> v zúčtovaní rovnako ako pri brokeroch. V Prehľade a v P&amp;L sa dividendy ukazujú ako samostatná zložka zisku. Presné daňové zaobchádzanie v reálnom živote rieš s poradcom — v aplikácii ide o prehľad a orientáciu.
              </p>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3. Zabezpečenie dát klienta</CardTitle>
            <CardDescription>Čo je chránené a čo odporúčame nastaviť v produkcii.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-foreground leading-relaxed">
            <section>
              <h3 className="text-base font-semibold mb-2">Ako chránime prihlásenie a heslá?</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  Heslá sa neukladajú v čitateľnej podobe; ukladajú sa ako <strong>hash + salt</strong> (scrypt).
                </li>
                <li>
                  Prihlasovanie je chránené <strong>rate limitom</strong> a dočasným zámkom účtu po viacerých neúspešných pokusoch.
                </li>
                <li>
                  Session cookie je nastavená ako <code>httpOnly</code> a v produkcii aj <code>secure</code> (len cez HTTPS).
                </li>
              </ul>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Môžem obmedziť registrácie len na schválené emaily?</h3>
              <p>
                Áno. V produkcii vieš zapnúť email allowlist cez{" "}
                <code>LOCAL_AUTH_EMAIL_ALLOWLIST</code> (zoznam emailov oddelených čiarkou). Registrácia mimo zoznamu bude odmietnutá.
              </p>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Čo odporúčame pre čo najvyššiu bezpečnosť?</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  V produkcii nastav silný <code>SESSION_SECRET</code> (dlhý náhodný reťazec, aspoň 32 znakov).
                </li>
                <li>
                  Prevádzkuj aplikáciu výhradne cez <strong>HTTPS</strong>.
                </li>
                <li>
                  Obmedz prístupy k databáze (least privilege), používaj pravidelné zálohy a overuj obnovu.
                </li>
                <li>
                  Aktualizuj závislosti a sleduj bezpečnostné upozornenia.
                </li>
              </ul>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Aké sú otváracie hodiny a čo znamená ikona mesiaca?</h3>
              <p>
                Pre americký trh používame orientačné časové pásma podľa času v Bratislave:
              </p>
              <ul className="list-disc pl-5 space-y-2 mt-2">
                <li>
                  <strong>PRE_MARKET:</strong> približne 10:00 – 15:30 (pracovné dni)
                </li>
                <li>
                  <strong>LIVE (hlavná relácia):</strong> 15:30 – 22:00
                </li>
                <li>
                  <strong>CLOSED:</strong> mimo týchto hodín a počas víkendu
                </li>
              </ul>
              <p className="mt-2">
                Ikona <strong>mesiaca</strong> označuje hodnoty mimo hlavnej burzovej relácie (pre-market / off-hours). Takéto ceny a percentá sa môžu meniť inak ako počas LIVE obchodovania a slúžia najmä ako orientačný prehľad pred otvorením trhu.
              </p>
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>4. Slovník pojmov</CardTitle>
            <CardDescription>Stručné definície.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-3 text-foreground leading-relaxed">
            <dl className="space-y-3">
              <div>
                <dt className="font-semibold">Realized P&amp;L (realizovaný zisk)</dt>
                <dd className="text-muted-foreground mt-0.5">
                  Zisk alebo strata z <strong>už uzavretých</strong> obchodov — predaných akcií podľa FIFO, prípadne ďalších hotovostných položiek (napr. XTB „close trade“), ktoré nie sú súčasťou klasického FIFO riadku predaja.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Unrealized P&amp;L (nerealizovaný zisk)</dt>
                <dd className="text-muted-foreground mt-0.5">
                  „Papierový“ zisk/strata z pozícií, ktoré <strong>ešte držíš</strong> — aktuálna trhová hodnota mínus náklad podľa stavu lotov (a zobrazenia v aplikácii).
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Net Invested / investované</dt>
                <dd className="text-muted-foreground mt-0.5">
                  V kontexte kariet na Prehľade súvisí s <strong>nákladom na otvorené pozície</strong> (súčet investovaného do držených akcií), nie čistý súčet všetkých vkladov mínus výbery — tie sú v logike hotovosti. Presný význam sa mierne líši podľa widgetu; pri TWR ide o MTM + hotovosť v čase.
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Benchmark (S&amp;P 500)</dt>
                <dd className="text-muted-foreground mt-0.5">
                  Porovnávací index (napr. <code>^GSPC</code>) na podobných časových segmentoch ako tvoje portfólio, aby si videl, či ťa výnos držania akcií držal nad alebo pod širokým americkým trhom. Nie je to osobná investičná odporúčacia služba.
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>5. Riešenie problémov</CardTitle>
            <CardDescription>Keď niečo nenájdeš alebo import zlyhá.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 text-sm text-foreground leading-relaxed">
            <section>
              <h3 className="text-base font-semibold mb-2">Nenašlo to môj ticker — čo robiť?</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  Skontroluj, či symbol z brokera zodpovedá tomu, čo očakávajú dátové zdroje (napr. prípona burzy <code>.DE</code>, <code>.AS</code> atď.).
                </li>
                <li>
                  Vyhľadaj správny obchodný symbol (napr. cez Yahoo Finance) a uprav ticker v <strong>Histórii</strong> pri manuálnom zadaní alebo po importe — ak aplikácia používa iný formát, záznam treba zosúladiť.
                </li>
                <li>
                  Ak ide o málo známy titul, kotácia alebo história nemusí byť dostupná — v tom prípade sa môže zobraziť posledná známa cena alebo chýbajúci graf.
                </li>
              </ul>
            </section>

            <Separator />

            <section>
              <h3 className="text-base font-semibold mb-2">Import z XTB zlyhal — prečo?</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li>
                  Použi export z XTB v podporovanom formáte — stránka Import uvádza očakávané stĺpce (napr. čas, typ, symbol, suma, komentár podľa typu exportu). <strong>CSV / XLSX</strong> musí zodpovedať šablóne „Cash operation history“ alebo podporovanému reportu, nie ľubovoľnému výstrižku.
                </li>
                <li>
                  Chýbajúce alebo premenované stĺpce spôsobia <strong>preskočené riadky alebo chyby</strong> v denníku importu — otvor zhrnutie importu a prečítaj prvé chybové hlášky.
                </li>
                <li>
                  Veľkosť súboru nad limit (napr. 10 MB) alebo poškodený súbor môže import úplne zastaviť.
                </li>
              </ul>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
