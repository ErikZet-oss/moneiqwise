import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

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

      <Card>
        <CardHeader>
          <CardTitle>Často kladené otázky</CardTitle>
          <CardDescription>
            Klikni na otázku pre zobrazenie odpovede.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="q1">
              <AccordionTrigger>Ako sa počíta výkonnosť portfólia (TWR)?</AccordionTrigger>
              <AccordionContent className="text-sm text-foreground leading-relaxed space-y-3">
                <p>
                  Používame prístup zarovnateľný s princípmi <strong>Time-Weighted Return (TWR)</strong> v duchu <strong>GIPS</strong>: výnos má odrážať výkon portfólia, nie načasovanie vkladov a výberov.
                </p>
                <Formula>
                  r<sub>n</sub> = (EV − (BV + CF)) / (BV + CF)
                </Formula>
                <p className="text-muted-foreground text-xs">
                  BV — hodnota na začiatku segmentu, CF — čisté cash flow, EV — hodnota na konci.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="q2">
              <AccordionTrigger>Čo je FIFO a ako ovplyvňuje zisk?</AccordionTrigger>
              <AccordionContent className="text-sm text-foreground leading-relaxed">
                Pri predaji sa najprv spotrebujú najstaršie loty (<strong>First-In, First-Out</strong>). Realizovaný zisk sa počíta proti FIFO nákladom v EUR ku dňu transakcie.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="q3">
              <AccordionTrigger>Ako funguje „Pred open“ a denné stavy trhu?</AccordionTrigger>
              <AccordionContent className="text-sm text-foreground leading-relaxed space-y-2">
                <p>
                  V Prehľade používame dynamické stavy podľa CET:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>PRE_MARKET (10:00–15:30 CET):</strong> denná zmena sa zobrazí ako 0,00 a pod ňou je sivý riadok „Pre-market“ so zmenou mimo regular session.</li>
                  <li><strong>LIVE (15:30–22:00 CET):</strong> denná zmena sa zobrazuje štandardne (zelená/červená).</li>
                  <li><strong>CLOSED (inokedy):</strong> zobrazuje sa jemný text „Trh uzatvorený“.</li>
                </ul>
                <p>
                  Pre US tickery sa dáta berú z Yahoo (vrátane fallbacku s <code>includePrePost=true</code>), takže „Pred open“ je spoľahlivejší.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="q4">
              <AccordionTrigger>Ako funguje Daňový asistent?</AccordionTrigger>
              <AccordionContent className="text-sm text-foreground leading-relaxed space-y-2">
                <p>
                  Daňový asistent je orientačný prehľad, ktorý vychádza z importovaných transakcií a interných výpočtov:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>realizované zisky/straty podľa FIFO,</li>
                  <li>dividendy a zrazená daň,</li>
                  <li>rozdelenie podľa daňových pásiem a roka,</li>
                  <li>sumáre pre formuláre (kde je to dostupné v dátach).</li>
                </ul>
                <p className="text-muted-foreground">
                  Je to pomocník pre kontrolu a prípravu podkladov, nie právne záväzný daňový výstup. Finálne podanie vždy over s daňovým poradcom.
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="q5">
              <AccordionTrigger>Prečo sa môže líšiť hotovosť alebo P&amp;L oproti brokerovi?</AccordionTrigger>
              <AccordionContent className="text-sm text-foreground leading-relaxed">
                Najčastejšie kvôli zaokrúhľovaniu, odlišným FX kurzom a odlišným pravidlám brokerov pri internom účtovaní. Pri väčšom rozdiele skontroluj import (vklady, výbery, poplatky, dividendy).
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="q6">
              <AccordionTrigger>Čo robiť, keď ticker alebo import nesedí?</AccordionTrigger>
              <AccordionContent className="text-sm text-foreground leading-relaxed">
                Skontroluj formát tickera (vrátane burzového suffixu), kompatibilitu exportu z brokera a chybové hlášky v denníku importu. Pri neštandardných tituloch nemusí byť kotácia dostupná.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
