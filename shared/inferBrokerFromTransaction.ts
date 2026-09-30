import type { Transaction } from "./schema";
import { BROKER_CODES, type BrokerCode } from "./schema";

const BROKER_LABEL: Record<BrokerCode, string> = {
  xtb: "XTB",
  ibkr: "Interactive Brokers",
  degiro: "DEGIRO",
  etoro: "eToro",
  trading212: "Trading 212",
  revolut: "Revolut",
  fio: "Fio banka",
  saxo: "Saxo Bank",
  freedom24: "Freedom24",
  tastyworks: "tastytrade",
  crypto: "Krypto burza",
  silver: "Striebro",
  other: "Iný / manuálne",
};

function isBrokerCode(v: string): v is BrokerCode {
  return (BROKER_CODES as readonly string[]).includes(v);
}

/** Broker predaja: portfólio → import prefix (etoro:) → other. */
export function inferBrokerKeyFromTransaction(
  tx: Pick<Transaction, "externalId" | "transactionId">,
  portfolioBrokerCode: string | null | undefined,
): BrokerCode {
  const ref = `${String(tx.externalId ?? "")} ${String(tx.transactionId ?? "")}`.toLowerCase();
  if (ref.includes("etoro:")) return "etoro";

  const pb = portfolioBrokerCode?.trim().toLowerCase();
  if (pb && isBrokerCode(pb)) return pb;

  if (ref.includes("xtb")) return "xtb";
  return "other";
}

export function brokerDisplayName(code: BrokerCode): string {
  return BROKER_LABEL[code] ?? code.toUpperCase();
}
