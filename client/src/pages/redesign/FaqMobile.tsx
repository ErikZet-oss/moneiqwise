import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, SectionHeader, TopBar } from "@/redesign/ui";

function Formula({ children }: { children: ReactNode }) {
  return (
    <div className="my-3 overflow-x-auto rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] p-3 font-mono text-xs leading-4 text-[var(--rd-text-primary)]">
      {children}
    </div>
  );
}

function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className="group border-b border-[var(--rd-border-subtle)] py-3 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start gap-2 text-sm font-semibold leading-5 text-[var(--rd-text-primary)] [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{question}</span>
        <ChevronDown className="mt-0.5 size-4 shrink-0 text-[var(--rd-text-tertiary)] transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-2 pt-2 text-xs leading-4 text-[var(--rd-text-secondary)] [&_code]:font-mono [&_strong]:text-[var(--rd-text-primary)]">
        {children}
      </div>
    </details>
  );
}

function FaqSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <Card>
        <SectionHeader title={title} />
        <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{description}</p>
        <div>{children}</div>
      </Card>
    </section>
  );
}

export default function FaqMobile() {
  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Pomoc" title="FAQ" />
      <div className="space-y-4 px-4 pb-6">
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Metodika výpočtov, dáta, import a pojmy. Text je informatívny; pri daňových a právnych záležitostiach sa spoľahni na odborníka.
        </p>

        <FaqSection
          title="1. Metodika výpočtov"
          description="Aplikácia nie je len jednoduchá kalkulačka — zohľadňuje čas peňažných tokov, FIFO náklady a meny."
        >
          <FaqItem question="Ako sa počíta výkonnosť portfólia (TWR)?">
            <p>
              Pre reťazenú výkonnosť používame prístup zarovnateľný s princípmi <strong>Time-Weighted Return (TWR)</strong> v duchu{" "}
              <strong>GIPS</strong> (Global Investment Performance Standards): výnos sa má odrážať od rozhodnutí a trhov, nie od toho, či si práve vložil alebo vybral hotovosť.
            </p>
            <p>
              Pre jednotlivé <strong>sub-periódy</strong> (po obdobiach medzi významnými peňažnými tokmi) sa často používa tvar základu, kde sa end-of-day hodnota porovná s hodnotou po zohľadnení tokov:
            </p>
            <Formula>
              r<sub>n</sub> = (EV − (BV + CF)) / (BV + CF)
            </Formula>
            <p>
              <strong>BV</strong> — hodnota na začiatku sub-periódy, <strong>CF</strong> — čisté vklady/výbery (spravidla vážené podľa času v období v plnej GIPS metodike),{" "}
              <strong>EV</strong> — hodnota na konci. Výsledné <strong>r<sub>n</sub></strong> očisťuje vývoj portfólia od „náhodného“ efektu, že práve v ten deň prišiel veľký vklad alebo výber.
            </p>
            <p>
              <strong>V našej implementácii</strong> delíme časovú os na <strong>segmenty</strong> medzi dátumami vkladov a výberov a medzi prvou udalosťou a dneškom. V každom segmente pracujeme s{" "}
              <strong>ohmatateľnou trhovou hodnotou (MTM) pozícií plus kumulovaná hotovosť</strong> v tvojom zobrazenom meny — podobne ako na Prehľade. Segmentové pomery sa <strong>reťazia</strong> (násobia{" "}
              <code>(1 + r)</code>), aby výsledok nezávisel od toho, či si hotovosť pridal skôr alebo neskôr v rámci rovnakého trhového vývoja.
            </p>
          </FaqItem>
          <FaqItem question="Čo je FIFO a ako ovplyvňuje zisk?">
            <p>
              <strong>FIFO (First-In, First-Out)</strong> znamená, že pri predaji sa najprv „spotrebujú“ najstaršie nakúpené kusy — presne v poradí nákupov.
            </p>
            <p>
              <strong>Príklad:</strong> Ak si kúpil 1 akciu za 100 € a neskôr ďalšiu 1 akciu za 120 €, pri predaji <strong>jedného</strong> kusu sa za náklad považuje <strong>100 €</strong> (prvá do radu). Zvyšok portfólia má stále druhý lot po 120 €.
            </p>
            <p>
              Realizovaný zisk z predaja sa počíta oproti týmto FIFO nákladom (v EUR v deň transakcie — pozri FX nižšie). Nerealizovaný zisk otvorených pozícií vychádza z aktuálnych cien oproti zostávajúcim lotom.
            </p>
          </FaqItem>
          <FaqItem question="Ako sa počíta celková hodnota (Total Value)?">
            <Formula>Celková hodnota ≈ súčet (aktuálna cena × počet kusov) po tituloch + hotovosť / margin</Formula>
            <p>
              „Akcie“ môžu zahŕňať aj odhad hodnoty otvorených opcií (prémie), ak máš v celku zapnuté portfóliá s opciami. Hotovosť je <strong>disponibilná EUR</strong> zúčtovaná z vkladov, výberov, obchodov, dividend, daní a pod. — nie len súčet vkladov.
            </p>
          </FaqItem>
          <FaqItem question="Ako riešime menové konverzie (FX)?">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Historicky pri transakcii:</strong> nákup/predaj v USD (a iných menách) sa prepočítava do EUR (a do meny zobrazenia) kurzom platným pri <strong>dátume transakcie</strong> — z uloženého kurzu v zázname, z EUR ekvivalentu, alebo z doplneného ECB kurzu (Frankfurter) pre daný deň. Tak sa snažíme, aby hotovosť a FIFO náklady sedeli s realitou obchodu.
              </li>
              <li>
                <strong>Aktuálna hodnota:</strong> dnešné ceny titulov sa berú v ich obchodnej mene a na Prehľade sa prepočítavajú do zvolenej meny používateľa <strong>aktuálnymi</strong> kurzami zobrazenia.
              </li>
            </ul>
            <p>Preto môže byť drobný rozdiel oproti brokerovi, ktorý používa iný zdroj kurzu alebo iné zaokrúhľovanie.</p>
          </FaqItem>
        </FaqSection>

        <FaqSection title="2. Spracovanie dát a import" description="Hotovosť, úroky, dividendy a súbory z brokera.">
          <FaqItem question="Prečo mi nesedí hotovosť o pár eur?">
            <p>
              Úprimne: <strong>zaokrúhľovanie</strong> (napr. na 2 desatinné miesta v importe aj v prepočtoch), <strong>odlišný kurz</strong> medzi brokerom a naším dátovým zdrojom (ECB / Frankfurter) a rôzne zaokrúhľovacie pravidlá u brokera môžu dať rozdiel v rádoch jednotiek až desiatok eur pri veľkom objeme transakcií. Ak je rozdiel systematicky väčší, skontroluj import a chýbajúce riadky (vklady, poplatky, dividendy).
            </p>
          </FaqItem>
          <FaqItem question="Započítavajú sa do zisku aj úroky z hotovosti?">
            <p>
              <strong>Áno.</strong> Položky <strong>Úrok z cash XTB</strong> (v dátach ticker <code>CASH_INTEREST</code>, úrok z free cash z importu XTB) sa evidujú ako peňažné toky zvyšujúce hotovosť. Zvyšujú celkovú hodnotu portfólia a tým aj celkový výnos (P&amp;L) v čase, keď sú pripísané — rovnako ako iné cash toky, ktoré zvyšujú disponibilnú sumu.
            </p>
          </FaqItem>
          <FaqItem question="Čo sa deje s dividendami?">
            <p>
              Dividendy evidujeme ako transakcie; <strong>čistá suma</strong> po zrážke (pole provízia / daň podľa zápisu) zvyčajne <strong>zvýši hotovosť</strong> v zúčtovaní rovnako ako pri brokeroch. V Prehľade a v P&amp;L sa dividendy ukazujú ako samostatná zložka zisku. Presné daňové zaobchádzanie v reálnom živote rieš s poradcom — v aplikácii ide o prehľad a orientáciu.
            </p>
          </FaqItem>
        </FaqSection>

        <FaqSection
          title="3. Zabezpečenie dát klienta"
          description="Čo je chránené a čo odporúčame nastaviť v produkcii."
        >
          <FaqItem question="Ako chránime prihlásenie a heslá?">
            <ul className="list-disc space-y-2 pl-5">
              <li>Heslá sa neukladajú v čitateľnej podobe; ukladajú sa ako <strong>hash + salt</strong> (scrypt).</li>
              <li>
                Prihlasovanie je chránené <strong>rate limitom</strong> a dočasným zámkom účtu po viacerých neúspešných pokusoch.
              </li>
              <li>
                Session cookie je nastavená ako <code>httpOnly</code> a v produkcii aj <code>secure</code> (len cez HTTPS).
              </li>
            </ul>
          </FaqItem>
          <FaqItem question="Môžem obmedziť registrácie len na schválené emaily?">
            <p>
              Áno. V produkcii vieš zapnúť email allowlist cez <code>LOCAL_AUTH_EMAIL_ALLOWLIST</code> (zoznam emailov oddelených čiarkou). Registrácia mimo zoznamu bude odmietnutá.
            </p>
          </FaqItem>
          <FaqItem question="Čo odporúčame pre čo najvyššiu bezpečnosť?">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                V produkcii nastav silný <code>SESSION_SECRET</code> (dlhý náhodný reťazec, aspoň 32 znakov).
              </li>
              <li>
                Prevádzkuj aplikáciu výhradne cez <strong>HTTPS</strong>.
              </li>
              <li>Obmedz prístupy k databáze (least privilege), používaj pravidelné zálohy a overuj obnovu.</li>
              <li>Aktualizuj závislosti a sleduj bezpečnostné upozornenia.</li>
            </ul>
          </FaqItem>
          <FaqItem question="Aké sú otváracie hodiny a čo znamená ikona mesiaca?">
            <p>Pre americký trh používame orientačné časové pásma podľa času v Bratislave:</p>
            <ul className="list-disc space-y-2 pl-5">
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
            <p>
              Ikona <strong>mesiaca</strong> označuje hodnoty mimo hlavnej burzovej relácie (pre-market / off-hours). Takéto ceny a percentá sa môžu meniť inak ako počas LIVE obchodovania a slúžia najmä ako orientačný prehľad pred otvorením trhu.
            </p>
          </FaqItem>
        </FaqSection>

        <FaqSection title="4. Slovník pojmov" description="Stručné definície.">
          <FaqItem question="Realized P&L (realizovaný zisk)">
            <p>
              Zisk alebo strata z <strong>už uzavretých</strong> obchodov — predaných akcií podľa FIFO, prípadne ďalších hotovostných položiek (napr. XTB „close trade“), ktoré nie sú súčasťou klasického FIFO riadku predaja.
            </p>
          </FaqItem>
          <FaqItem question="Unrealized P&L (nerealizovaný zisk)">
            <p>
              „Papierový“ zisk/strata z pozícií, ktoré <strong>ešte držíš</strong> — aktuálna trhová hodnota mínus náklad podľa stavu lotov (a zobrazenia v aplikácii).
            </p>
          </FaqItem>
          <FaqItem question="Net Invested / investované">
            <p>
              V kontexte kariet na Prehľade súvisí s <strong>nákladom na otvorené pozície</strong> (súčet investovaného do držených akcií), nie čistý súčet všetkých vkladov mínus výbery — tie sú v logike hotovosti. Presný význam sa mierne líši podľa widgetu; pri TWR ide o MTM + hotovosť v čase.
            </p>
          </FaqItem>
          <FaqItem question="Benchmark (S&P 500)">
            <p>
              Porovnávací index (napr. <code>^GSPC</code>) na podobných časových segmentoch ako tvoje portfólio, aby si videl, či ťa výnos držania akcií držal nad alebo pod širokým americkým trhom. Nie je to osobná investičná odporúčacia služba.
            </p>
          </FaqItem>
        </FaqSection>

        <FaqSection
          title="5. AI Agent — Paper Bot"
          description="Kompletný popis paper trading sekcie: čo robí, čo beží na pozadí a čo ešte nie je."
        >
          <FaqItem question="Čo to je?">
            <p>
              <strong>Paper Bot</strong> je samostatná záložka v <strong>AI Agent → Paper</strong>. Umožňuje vytvoriť jeden alebo viac botov s <strong>fiktívnym kapitálom</strong>. Bot <strong>sám otvára a zatvára paper pozície</strong> podľa kvantitatívnej stratégie, risk limitov a voliteľného Claude AI „nudge“ zo správ. Nič sa neposiela na brokera — peniaze nie sú reálne. Ceny sú však reálne (Yahoo Finance).
            </p>
            <p>
              Oddelené od klasického <strong>AI Bot</strong> (denný audit / odporúčania BUY-SELL-HOLD bez automatickej exekúcie).
            </p>
          </FaqItem>
          <FaqItem question="Čo nastavíš pri vytvorení bota?">
            <ul className="list-disc space-y-2 pl-5">
              <li>Názov a počiatočný kapitál (EUR)</li>
              <li>Zoznam tickerov (universe)</li>
              <li>
                Stratégiu: EMA+RSI Trend, MA Crossover, RSI Mean Reversion, Dual Momentum, <strong>MACD Trend</strong>,{" "}
                <strong>Bollinger Reversion</strong>, alebo <strong>Vlastná (editor)</strong> s podmienkami ALL/ANY (EMA/SMA/RSI/ATR/MACD/BB/volume)
              </li>
              <li>
                <strong>Timeframe signálov</strong>: 1d (denné), 1h alebo 15m — stratégie počítajú na zvolených baroch (nie len denných)
              </li>
              <li>Risk: denný loss limit %, max drawdown %, max počet otvorených pozícií, max % equity na jednu pozíciu</li>
              <li>
                Exity: trailing ATR, take profit %, hard stop %, <strong>min hold (bary)</strong>, <strong>min zisk % pred strategy SELL</strong>,{" "}
                <strong>trail arm %</strong>, voliteľne <strong>trail len v pluse</strong>, plus paper <strong>half-spread % + fee %</strong> na fill
              </li>
              <li>
                AI: influence % (typicky 20) a minimálna confidence; Claude dostane správy + snapshot (close/RSI/EMA/MACD) a sám trade nevytvára
              </li>
              <li>E-mail notifikácie pri open/close/kill (vyžaduje SMTP na serveri; inak sa skipne)</li>
              <li>
                <strong>Backtest</strong> pred štartom — spustí stratégiu na histórii Yahoo podľa zvoleného timeframe a ukáže return / win rate / počet obchodov (bez AI nudge)
              </li>
            </ul>
          </FaqItem>
          <FaqItem question="Ako beží automatika na pozadí?">
            <p>
              Po kliknutí na <strong>Štart</strong> je bot v stave <code>running</code>. Scheduler mení interval podľa US relácie (čas Bratislava):{" "}
              <strong>LIVE ~20 s</strong>, pre/post ~45 s, mimo trhu ~90 s. Manuálne: <strong>Tick teraz</strong>.
            </p>
            <p>
              Počas LIVE/EXTENDED sa mark ceny dopĺňa aj z 1-minútových Yahoo barov (čerstvejší MTM); signály stratégií počítajú z zvoleného timeframe (1d / 1h / 15m OHLCV vrátane volume).
            </p>
            <p>Jeden tick prechádza <strong>Signal Chain</strong>:</p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <strong>INGEST</strong> — Yahoo OHLCV podľa timeframe + live mark
              </li>
              <li>
                <strong>DEDUP</strong> — príprava / zoskupenie tickerov
              </li>
              <li>
                <strong>SIGNAL</strong> — kvant stratégia (prednastavená alebo custom editor)
              </li>
              <li>
                <strong>AI</strong> (ak influence &gt; 0) — Claude dostane správy + technický snapshot (RSI/EMA/MACD); moduluje skóre; silný bearish môže zablokovať nákup
              </li>
              <li>
                <strong>RISK</strong> — daily loss, max DD, max pozície, veľkosť pozície
              </li>
              <li>
                <strong>EXEC</strong> — paper open/close + e-mail ak je zapnutý
              </li>
            </ol>
            <p>
              Exity: najprv hard stop / take profit / trailing ATR, potom strategický SELL (až po min hold a — v pluse — až po min zisk %). Trailing u nových botov sa aktivuje až po „trail arm %“ a voliteľne nikdy nezatvorí pod entry. Paper fill zahŕňa half-spread + fee (default ~0.10 % na stranu).
            </p>
            <p>
              Stratégie majú prísnejšie SELL (MACD: hist+signal; EMA: nie hneď pod SMA50; MA: dead zone; RSI/BB vyššie rebound prahy). Všetko ide do logu (
              <code>tick</code>, <code>pipeline</code>, <code>signal</code>, <code>ai</code>, <code>open</code>, <code>close</code>, <code>blocked</code>, <code>kill</code>).
            </p>
            <p>Ak server (hosting) nebeží, boty netickujú. Lokálne vypnutý PC = žiadny nonstop beh.</p>
          </FaqItem>
          <FaqItem question="Čo vidíš v UI?">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong>Signal Chain</strong> — vizuálny pipeline INGEST→…→EXEC; klik / hover na stupeň ukáže vysvetlenie. Zvýraznený je posledný aktívny krok.
              </li>
              <li>
                <strong>Výkon</strong> — return %, realizovaný P&amp;L, win rate, avg win/loss, open/close/blocked, equity krivka
              </li>
              <li>
                <strong>Otvorené / Obchody / Log</strong> — pozície a história fills s dôvodom (stratégia, skóre, AI bias/confidence), kompletný audit
              </li>
              <li>
                <strong>Kill Switch</strong> — zatvorí pozície a zastaví bota; Pauza len zastaví tickovanie
              </li>
              <li>
                <strong>Upraviť</strong> — zmena stratégie, tickerov, TF, risk, exitov a AI u existujúceho bota (kapitál sa nemení; zabitý bot sa nedá editovať)
              </li>
              <li>
                <strong>AI vs. realita</strong> (Výkon) — win rate / avg PnL obchodov so započítanou AI vs. bez nej + podľa AI bias pri vstupe
              </li>
              <li>
                AI verdicty sa <strong>cachujú ~10 min</strong> (menej volaní Claude, lacnejšie); v logu uvidíš „AI cache hit“
              </li>
              <li>
                <strong>Backtest</strong> — výsledok paper simulácie na histórii pred live paper behom
              </li>
            </ul>
          </FaqItem>
          <FaqItem question="Dôležité limity dnešnej verzie">
            <ul className="list-disc space-y-2 pl-5">
              <li>Len paper (interný ledger), nie Alpaca/Binance ani reálne peniaze</li>
              <li>
                Paper fill modeluje half-spread + fee; MTM mark ostáva mid — nerealizovaný P&amp;L môže vyzerať lepšie ako po skutočnom close
              </li>
              <li>Len long smer; short zatiaľ nie</li>
              <li>
                Return % = (equity − počiatočný kapitál) / kapitál; zahŕňa aj nerealizovaný P&amp;L z otvorených pozícií. Realizovaný P&amp;L je len zo zatvorených obchodov.
              </li>
              <li>Backtest bez Claude AI nudge (čistá matematika + exit rules)</li>
              <li>
                E-mail vyžaduje SMTP env (<code>SMTP_HOST</code>, <code>SMTP_USER</code>, …)
              </li>
              <li>
                AI vrstva vyžaduje <code>ANTHROPIC_API_KEY</code>; bez kľúča beží quant-only (novšie Claude modely nepoužívajú <code>temperature</code>). Pri chybnom JSON AI skúsi 1× retry, inak fallback na čistý quant.
              </li>
              <li>Paper vs. benchmark (S&amp;P) zatiaľ nie je</li>
            </ul>
          </FaqItem>
        </FaqSection>

        <FaqSection title="6. Riešenie problémov" description="Keď niečo nenájdeš alebo import zlyhá.">
          <FaqItem question="Nenašlo to môj ticker — čo robiť?">
            <ul className="list-disc space-y-2 pl-5">
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
          </FaqItem>
          <FaqItem question="Import z XTB zlyhal — prečo?">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Použi export z XTB v podporovanom formáte — stránka Import uvádza očakávané stĺpce. <strong>XLSX</strong> môže byť <strong>nový</strong> report (hárky „Cash Operations“, „Open Positions“) alebo <strong>starý</strong> „Cash operation history“ — nie ľubovoľný výstrižok.
              </li>
              <li>
                Chýbajúce alebo premenované stĺpce spôsobia <strong>preskočené riadky alebo chyby</strong> v denníku importu — otvor zhrnutie importu a prečítaj prvé chybové hlášky.
              </li>
              <li>Veľkosť súboru nad limit (napr. 10 MB) alebo poškodený súbor môže import úplne zastaviť.</li>
            </ul>
          </FaqItem>
        </FaqSection>
      </div>
    </div>
  );
}
