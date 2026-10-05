import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  buildPokemonPosition,
  POKEMON_GRADE_COMPANIES,
  POKEMON_GRADE_VALUES,
  type PokemonCardHit,
  type PokemonPosition,
  type PokemonTcgCategory,
} from "@shared/pokemonTcg";

export type PokemonFormPosition = Extract<PokemonPosition, { ok: true }> & {
  euLowEur: number | null;
};

type Props = {
  onPositionChange: (position: PokemonFormPosition | null) => void;
};

function formatLow(card: PokemonCardHit, graded: boolean): string {
  if (graded) {
    if (card.gradePriceEur == null) return "Cena stupňa v API nie je";
    return `${card.gradePriceEur.toFixed(2)} €`;
  }
  if (card.euLowEur == null) return "Anglická cena v API nie je";
  return `${card.euLowEur.toFixed(2)} €`;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

type EpisodeHit = { id: string; name: string; code: string };

const SORTS = [
  { id: "relevance", label: "Relevancia" },
  { id: "price_highest", label: "Najdrahšie" },
  { id: "price_lowest", label: "Najlacnejšie" },
] as const;

const CATEGORIES: { id: PokemonTcgCategory; label: string }[] = [
  { id: "RAW_CARD", label: "Raw" },
  { id: "GRADED_CARD", label: "Graded" },
  { id: "SEALED_PRODUCT", label: "Sealed" },
];

export function PokemonTransactionFields({ onPositionChange }: Props) {
  const [category, setCategory] = useState<PokemonTcgCategory>("RAW_CARD");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PokemonCardHit | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualSet, setManualSet] = useState("");
  const [manualImage, setManualImage] = useState("");
  const [gradeCompany, setGradeCompany] = useState("PSA");
  const [gradeValue, setGradeValue] = useState("10");
  const [certNumber, setCertNumber] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("relevance");
  const [cardNumber, setCardNumber] = useState("");
  const [episodeQuery, setEpisodeQuery] = useState("");
  const [episode, setEpisode] = useState<EpisodeHit | null>(null);
  const debouncedQuery = useDebounce(query, 400);
  const debouncedEpisode = useDebounce(episodeQuery, 400);
  const debouncedNumber = useDebounce(cardNumber, 400);
  const isSealed = category === "SEALED_PRODUCT";
  const isGraded = category === "GRADED_CARD";
  const canSearch = debouncedQuery.trim().length >= 2 || Boolean(episode) || (!isSealed && debouncedNumber.trim().length >= 1);

  const { data: episodes } = useQuery<EpisodeHit[]>({
    queryKey: ["/api/pokemon/episodes", debouncedEpisode],
    queryFn: async () => {
      const res = await fetch(`/api/pokemon/episodes?q=${encodeURIComponent(debouncedEpisode)}`);
      if (!res.ok) throw new Error("episodes failed");
      return res.json();
    },
    enabled: debouncedEpisode.trim().length >= 2 && !episode,
  });

  const { data: cards, isLoading, isError } = useQuery<PokemonCardHit[]>({
    queryKey: ["/api/pokemon/search", isSealed ? "products" : "cards", debouncedQuery, episode?.id ?? "", debouncedNumber, sort, isGraded ? gradeCompany : "", isGraded ? gradeValue : ""],
    queryFn: async () => {
      const params = new URLSearchParams({
        kind: isSealed ? "products" : "cards",
        q: debouncedQuery.trim(),
        sort,
      });
      if (episode) params.set("episodeId", episode.id);
      if (!isSealed && debouncedNumber.trim()) params.set("cardNumber", debouncedNumber.trim());
      if (isGraded) {
        params.set("gradeCompany", gradeCompany);
        params.set("gradeValue", gradeValue);
      }
      const res = await fetch(`/api/pokemon/search?${params.toString()}`);
      if (!res.ok) throw new Error("search failed");
      return res.json();
    },
    enabled: canSearch,
  });

  useEffect(() => {
    const productName = selected ? selected.name : manualName;
    const setName = !selected ? manualSet : isSealed ? "" : selected.setName;
    const imageUrl = selected ? selected.imageUrl ?? "" : manualImage;
    const externalId = selected ? selected.externalId : "";
    const built = buildPokemonPosition({
      category,
      productName,
      setName,
      gradeCompany: category === "GRADED_CARD" ? gradeCompany : null,
      gradeValue: category === "GRADED_CARD" ? gradeValue : null,
      certNumber: category === "GRADED_CARD" ? certNumber : null,
      imageUrl,
      externalId,
      cardmarketId: selected ? selected.cardmarketId : null,
      tcggoId: selected?.tcggoId ?? null,
    });
    if (!built.ok) {
      onPositionChange(null);
      return;
    }
    onPositionChange({
      ...built,
      euLowEur: selected ? selected.euLowEur : null,
    });
  }, [
    category,
    selected,
    manualName,
    manualSet,
    manualImage,
    gradeCompany,
    gradeValue,
    certNumber,
    isSealed,
    onPositionChange,
  ]);

  const pickCard = (card: PokemonCardHit) => {
    setSelected(card);
    setManualName(card.name);
    setManualSet(card.setName);
    setQuery("");
    setOpen(false);
  };

  const clearCard = () => {
    setSelected(null);
  };

  return (
    <div className="space-y-4 p-4 rounded-lg border border-dashed bg-muted/40">
      <div>
        <p className="text-sm font-medium">Pokémon TCG</p>
        <p className="text-xs text-muted-foreground mt-1">
          Nákupná cena je to, čo ste zaplatili v EUR. Hodnota v prehľade je anglický Cardmarket z TCG API:
          Near Mint pre raw, lowest pre sealed a cena stupňa pre graded.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={category === item.id ? "default" : "outline"}
            onClick={() => {
              if (item.id === category) return;
              setCategory(item.id);
              setSelected(null);
              setQuery("");
              setCardNumber("");
              setEpisode(null);
              setEpisodeQuery("");
              setManualName("");
              setManualSet("");
              setManualImage("");
            }}
            data-testid={`button-pokemon-category-${item.id}`}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Sada</Label>
          <Input
            value={episode ? `${episode.name}${episode.code ? ` (${episode.code})` : ""}` : episodeQuery}
            onChange={(e) => {
              setEpisode(null);
              setEpisodeQuery(e.target.value);
            }}
            placeholder="napr. 30th Celebration"
            data-testid="input-pokemon-episode"
          />
          {!episode && episodes && episodes.length > 0 && (
            <div className="rounded-md border bg-background">
              {episodes.slice(0, 6).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setEpisode(item);
                    setEpisodeQuery("");
                  }}
                >
                  {item.name}
                  {item.code ? ` · ${item.code}` : ""}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Zoradiť</Label>
          <Select value={sort} onValueChange={(value) => setSort(value as (typeof SORTS)[number]["id"])}>
            <SelectTrigger data-testid="select-pokemon-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!isSealed && (
          <div className="space-y-2 sm:col-span-2">
            <Label>Číslo karty</Label>
            <Input
              value={cardNumber}
              onChange={(e) => setCardNumber(e.target.value)}
              placeholder="napr. 125 alebo GG44"
              data-testid="input-pokemon-card-number"
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
          <Label>{isSealed ? "Sealed produkt" : "Karta"}</Label>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                className="w-full justify-between"
                data-testid="button-pokemon-search"
              >
                <span className="truncate">
                  {selected ? `${selected.name} · ${selected.setName}` : isSealed ? "Vyhľadajte ETB, booster, tin…" : "Vyhľadajte kartu..."}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(420px,90vw)] p-0">
              <div className="flex items-center border-b px-3">
                <Input
                  placeholder={isSealed ? "napr. 30th Celebration Elite Trainer Box" : "Názov karty, napr. Charizard"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="border-0 focus-visible:ring-0 h-11"
                  data-testid="input-pokemon-search"
                  autoFocus
                />
              </div>
              <div className="max-h-[min(70vh,420px)] overflow-y-auto">
                {isLoading && (
                  <div className="p-4 text-center">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                  </div>
                )}
                {isError && (
                  <p className="p-3 text-sm text-destructive">
                    Katalóg sa nepodarilo načítať. Položku môžete zadať ručne.
                  </p>
                )}
                {!isLoading && cards && cards.length > 0 && (
                  <div className="p-1">
                    {cards.map((card) => (
                      <button
                        key={card.externalId}
                        type="button"
                        onClick={() => pickCard(card)}
                        className="flex w-full items-center gap-2 px-2 py-1.5 rounded-sm text-left hover:bg-accent"
                        data-testid={`option-pokemon-${card.externalId}`}
                      >
                        <Check className={cn("h-4 w-4", selected?.externalId === card.externalId ? "opacity-100" : "opacity-0")} />
                        {card.imageUrl ? (
                          <img src={card.imageUrl} alt="" className="h-12 w-9 object-contain rounded-sm bg-background" />
                        ) : (
                          <span className="h-12 w-9 rounded-sm bg-muted" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{card.name}</span>
                          <span className="block text-xs text-muted-foreground truncate">
                            {card.setName}
                            {card.number ? ` · #${card.number}` : ""}
                          </span>
                          <span className="block text-xs tabular-nums">
                            {category === "GRADED_CARD" ? formatLow(card, true) : formatLow(card, false)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!isLoading && canSearch && cards && cards.length === 0 && (
                  <p className="p-3 text-sm text-muted-foreground">
                    Nič sa nenašlo. Skúste kratší názov alebo zadajte položku ručne.
                  </p>
                )}
                {!canSearch && (
                  <p className="p-3 text-sm text-muted-foreground">Zadajte aspoň 2 znaky.</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {selected && (
            <div className="flex items-center gap-3 text-sm">
              {selected.imageUrl ? (
                <img src={selected.imageUrl} alt="" className="h-16 w-12 object-contain rounded bg-background" />
              ) : null}
              <div className="min-w-0">
                <p className="font-medium truncate">{selected.name}</p>
                <p className="text-xs text-muted-foreground truncate">{selected.setName}</p>
                <p className="text-xs tabular-nums">
                  {formatLow(selected, category === "GRADED_CARD")}
                </p>
                <button type="button" className="text-xs text-primary hover:underline" onClick={clearCard}>
                  Zadať iný názov ručne
                </button>
              </div>
            </div>
          )}
        </div>

      {!selected && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2 sm:col-span-2">
            <Label>{isSealed ? "Produkt (ETB, bundle, tin…)" : "Názov karty"}</Label>
            <Input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder={isSealed ? "napr. Prismatic Evolutions Elite Trainer Box" : "napr. Charizard ex"}
              data-testid="input-pokemon-product-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Séria / set</Label>
            <Input
              value={manualSet}
              onChange={(e) => setManualSet(e.target.value)}
              placeholder="voliteľné"
              data-testid="input-pokemon-set-name"
            />
          </div>
          <div className="space-y-2">
            <Label>URL obrázka</Label>
            <Input
              value={manualImage}
              onChange={(e) => setManualImage(e.target.value)}
              placeholder="https://…"
              data-testid="input-pokemon-image-url"
            />
          </div>
        </div>
      )}

      {category === "GRADED_CARD" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label>Spoločnosť</Label>
            <Select value={gradeCompany} onValueChange={setGradeCompany}>
              <SelectTrigger data-testid="select-pokemon-grade-company">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POKEMON_GRADE_COMPANIES.map((company) => (
                  <SelectItem key={company} value={company}>
                    {company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Stupeň</Label>
            <Select value={gradeValue} onValueChange={setGradeValue}>
              <SelectTrigger data-testid="select-pokemon-grade-value">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POKEMON_GRADE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Číslo certifikátu</Label>
            <Input
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              placeholder="voliteľné"
              data-testid="input-pokemon-cert"
            />
          </div>
          <p className="sm:col-span-3 text-xs text-muted-foreground">
            Rovnaká karta a rovnaký stupeň sa sčítajú ako kusy (FIFO). Certifikát ostáva pri konkrétnom nákupe.
            Obrázok je sken raw karty. Trhová cena je Cardmarket cena tohto stupňa v EUR, nie cena raw karty.
          </p>
        </div>
      )}
    </div>
  );
}
