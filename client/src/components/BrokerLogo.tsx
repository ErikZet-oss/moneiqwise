import { useState } from "react";
import type { BrokerCode } from "@shared/schema";

interface BrokerInfo {
  name: string;
  shortName: string;
  color: string;
  textColor: string;
}

/** Domény pre Brand API (logo.dev) — rovnaký token ako pri CompanyLogo. */
const LOGO_DEV_TOKEN = "pk_X-1ZO13GSgeOoUrIuJ6GMQ";

const BROKER_LOGO_DOMAIN: Partial<Record<BrokerCode, string>> = {
  xtb: "xtb.com",
  ibkr: "interactivebrokers.com",
  degiro: "degiro.com",
  etoro: "etoro.com",
  trading212: "trading212.com",
  revolut: "revolut.com",
  fio: "fio.cz",
  saxo: "saxobank.com",
  freedom24: "freedom24.com",
  tastyworks: "tastytrade.com",
  crypto: "bitcoin.org",
};

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

const sizeClasses = {
  xs: "w-4 h-4 text-[8px]",
  sm: "w-6 h-6 text-[10px]",
  md: "w-8 h-8 text-xs",
  lg: "w-10 h-10 text-sm",
} as const;

type LogoSize = keyof typeof sizeClasses;

function BrokerLogoMark({
  brokerCode,
  broker,
  size,
  "data-testid": testId,
}: {
  brokerCode: BrokerCode;
  broker: BrokerInfo;
  size: LogoSize;
  "data-testid"?: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const domain = BROKER_LOGO_DOMAIN[brokerCode];
  const showInitials = brokerCode === "other" || !domain || logoFailed;

  const shortLen = size === "xs" ? 2 : 3;
  const boxClass = `${sizeClasses[size]} rounded-md flex items-center justify-center font-bold shrink-0`;

  if (showInitials) {
    return (
      <div
        className={boxClass}
        style={{ backgroundColor: broker.color, color: broker.textColor }}
        title={broker.name}
        data-testid={testId}
      >
        {broker.shortName.slice(0, shortLen)}
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-md overflow-hidden shrink-0 bg-muted/80 dark:bg-muted flex items-center justify-center p-0.5`}
      title={broker.name}
      data-testid={testId}
    >
      <img
        src={`https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}`}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="max-h-full max-w-full object-contain"
        onError={() => setLogoFailed(true)}
      />
    </div>
  );
}

interface BrokerLogoProps {
  brokerCode: BrokerCode | null | undefined;
  size?: LogoSize;
  showName?: boolean;
}

export function BrokerLogo({ brokerCode, size = "md", showName = false }: BrokerLogoProps) {
  if (!brokerCode) return null;

  const broker = BROKER_CATALOG[brokerCode];
  if (!broker) return null;

  return (
    <div className="flex items-center gap-2" data-testid={`broker-logo-${brokerCode}`}>
      <BrokerLogoMark
        brokerCode={brokerCode}
        broker={broker}
        size={size}
        data-testid={`broker-logo-img-${brokerCode}`}
      />
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
      <BrokerLogoMark brokerCode={brokerCode} broker={broker} size="sm" />
      <span>{broker.name}</span>
    </div>
  );
}
