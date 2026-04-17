import type { BrokerCode } from "@shared/schema";

interface BrokerInfo {
  name: string;
  shortName: string;
  color: string;
  textColor: string;
}

export const BROKER_CATALOG: Record<BrokerCode, BrokerInfo> = {
  xtb: {
    name: "XTB",
    shortName: "XTB",
    color: "#e31e24",
    textColor: "#ffffff",
  },
  ibkr: {
    name: "Interactive Brokers",
    shortName: "IBKR",
    color: "#d41f28",
    textColor: "#ffffff",
  },
  degiro: {
    name: "DEGIRO",
    shortName: "DEG",
    color: "#00b4e6",
    textColor: "#ffffff",
  },
  etoro: {
    name: "eToro",
    shortName: "eTo",
    color: "#6cbc42",
    textColor: "#ffffff",
  },
  trading212: {
    name: "Trading 212",
    shortName: "T212",
    color: "#1b1d3e",
    textColor: "#ffffff",
  },
  revolut: {
    name: "Revolut",
    shortName: "REV",
    color: "#0075eb",
    textColor: "#ffffff",
  },
  fio: {
    name: "Fio banka",
    shortName: "FIO",
    color: "#006837",
    textColor: "#ffffff",
  },
  saxo: {
    name: "Saxo Bank",
    shortName: "SAX",
    color: "#003087",
    textColor: "#ffffff",
  },
  freedom24: {
    name: "Freedom24",
    shortName: "F24",
    color: "#00a0df",
    textColor: "#ffffff",
  },
  tastyworks: {
    name: "Tastyworks",
    shortName: "TW",
    color: "#ff6600",
    textColor: "#ffffff",
  },
  crypto: {
    name: "Kryptomeny",
    shortName: "₿",
    color: "#f7931a",
    textColor: "#ffffff",
  },
  other: {
    name: "Iný broker",
    shortName: "?",
    color: "#6b7280",
    textColor: "#ffffff",
  },
};

interface BrokerLogoProps {
  brokerCode: BrokerCode | null | undefined;
  size?: "xs" | "sm" | "md" | "lg";
  showName?: boolean;
}

export function BrokerLogo({ brokerCode, size = "md", showName = false }: BrokerLogoProps) {
  if (!brokerCode) return null;
  
  const broker = BROKER_CATALOG[brokerCode];
  if (!broker) return null;

  const sizeClasses = {
    xs: "w-4 h-4 text-[8px]",
    sm: "w-6 h-6 text-[10px]",
    md: "w-8 h-8 text-xs",
    lg: "w-10 h-10 text-sm",
  };

  return (
    <div className="flex items-center gap-2" data-testid={`broker-logo-${brokerCode}`}>
      <div
        className={`${sizeClasses[size]} rounded-md flex items-center justify-center font-bold shrink-0`}
        style={{ backgroundColor: broker.color, color: broker.textColor }}
        title={broker.name}
      >
        {broker.shortName.slice(0, size === "xs" ? 2 : 3)}
      </div>
      {showName && (
        <span className="text-sm text-muted-foreground">{broker.name}</span>
      )}
    </div>
  );
}

interface BrokerSelectItemProps {
  brokerCode: BrokerCode;
}

export function BrokerSelectItem({ brokerCode }: BrokerSelectItemProps) {
  const broker = BROKER_CATALOG[brokerCode];
  
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[10px] shrink-0"
        style={{ backgroundColor: broker.color, color: broker.textColor }}
      >
        {broker.shortName.slice(0, 3)}
      </div>
      <span>{broker.name}</span>
    </div>
  );
}
