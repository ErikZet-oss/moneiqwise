import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Building2 } from "lucide-react";

interface CompanyLogoProps {
  ticker: string;
  companyName?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const tickerToDomain: Record<string, string> = {
  "AAPL": "apple.com",
  "MSFT": "microsoft.com",
  "GOOGL": "google.com",
  "GOOG": "google.com",
  "AMZN": "amazon.com",
  "META": "meta.com",
  "TSLA": "tesla.com",
  "NVDA": "nvidia.com",
  "AMD": "amd.com",
  "INTC": "intel.com",
  "NFLX": "netflix.com",
  "DIS": "disney.com",
  "PYPL": "paypal.com",
  "V": "visa.com",
  "MA": "mastercard.com",
  "JPM": "jpmorganchase.com",
  "BAC": "bankofamerica.com",
  "WFC": "wellsfargo.com",
  "C": "citigroup.com",
  "GS": "goldmansachs.com",
  "MS": "morganstanley.com",
  "UBER": "uber.com",
  "LYFT": "lyft.com",
  "ABNB": "airbnb.com",
  "SQ": "squareup.com",
  "SHOP": "shopify.com",
  "SPOT": "spotify.com",
  "SNAP": "snapchat.com",
  "PINS": "pinterest.com",
  "TWTR": "twitter.com",
  "X": "twitter.com",
  "ZM": "zoom.us",
  "DOCU": "docusign.com",
  "CRM": "salesforce.com",
  "ORCL": "oracle.com",
  "IBM": "ibm.com",
  "CSCO": "cisco.com",
  "ADBE": "adobe.com",
  "NOW": "servicenow.com",
  "SNOW": "snowflake.com",
  "PLTR": "palantir.com",
  "NET": "cloudflare.com",
  "DDOG": "datadoghq.com",
  "MDB": "mongodb.com",
  "OKTA": "okta.com",
  "CRWD": "crowdstrike.com",
  "ZS": "zscaler.com",
  "PANW": "paloaltonetworks.com",
  "FTNT": "fortinet.com",
  "WMT": "walmart.com",
  "TGT": "target.com",
  "COST": "costco.com",
  "HD": "homedepot.com",
  "LOW": "lowes.com",
  "NKE": "nike.com",
  "LULU": "lululemon.com",
  "SBUX": "starbucks.com",
  "MCD": "mcdonalds.com",
  "KO": "coca-cola.com",
  "PEP": "pepsico.com",
  "PG": "pg.com",
  "JNJ": "jnj.com",
  "UNH": "unitedhealthgroup.com",
  "PFE": "pfizer.com",
  "MRNA": "modernatx.com",
  "ABBV": "abbvie.com",
  "LLY": "lilly.com",
  "MRK": "merck.com",
  "BMY": "bms.com",
  "GILD": "gilead.com",
  "AMGN": "amgen.com",
  "BIIB": "biogen.com",
  "BA": "boeing.com",
  "LMT": "lockheedmartin.com",
  "RTX": "rtx.com",
  "GD": "gd.com",
  "NOC": "northropgrumman.com",
  "CAT": "caterpillar.com",
  "DE": "deere.com",
  "MMM": "3m.com",
  "HON": "honeywell.com",
  "GE": "ge.com",
  "F": "ford.com",
  "GM": "gm.com",
  "TM": "toyota.com",
  "HMC": "honda.com",
  "RACE": "ferrari.com",
  "XOM": "exxonmobil.com",
  "CVX": "chevron.com",
  "COP": "conocophillips.com",
  "OXY": "oxy.com",
  "SLB": "slb.com",
  "T": "att.com",
  "VZ": "verizon.com",
  "TMUS": "t-mobile.com",
  "CMCSA": "comcast.com",
  "CHTR": "charter.com",
  "COIN": "coinbase.com",
  "HOOD": "robinhood.com",
  "SOFI": "sofi.com",
  "AFRM": "affirm.com",
  "UPST": "upstart.com",
  "NU": "nubank.com.br",
  "BABA": "alibaba.com",
  "JD": "jd.com",
  "PDD": "pinduoduo.com",
  "BIDU": "baidu.com",
  "NIO": "nio.com",
  "XPEV": "xiaopeng.com",
  "LI": "lixiang.com",
  "TSM": "tsmc.com",
  "ASML": "asml.com",
  "ARM": "arm.com",
  "QCOM": "qualcomm.com",
  "AVGO": "broadcom.com",
  "TXN": "ti.com",
  "MU": "micron.com",
  "MRVL": "marvell.com",
  "LRCX": "lamresearch.com",
  "AMAT": "appliedmaterials.com",
  "KLAC": "kla.com",
  "ADI": "analog.com",
  "MCHP": "microchip.com",
  "ON": "onsemi.com",
  "NXPI": "nxp.com",
  "SWKS": "skyworksinc.com",
  "QRVO": "qorvo.com",
  "WBD": "wbd.com",
  "PARA": "paramount.com",
  "FOX": "fox.com",
  "VICI": "vfreit.com",
  "O": "realtyincome.com",
  "AMT": "americantower.com",
  "CCI": "crowncastle.com",
  "EQIX": "equinix.com",
  "DLR": "digitalrealty.com",
  "SPG": "simon.com",
  "PSA": "publicstorage.com",
  "EXR": "extraspace.com",
  "AVB": "avalonbay.com",
  "EQR": "equityapartments.com",
  "MAA": "maac.com",
  "UDR": "udr.com",
  "CPT": "camdenliving.com",
  "ESS": "essexapartmenthomes.com",
  "INVH": "invh.com",
  "AMH": "americanhomes4rent.com",
  "RBLX": "roblox.com",
  "U": "unity.com",
  "EA": "ea.com",
  "TTWO": "take2games.com",
  "ATVI": "activision.com",
  "RIVN": "rivian.com",
  "LCID": "lucidmotors.com",
  "HIMS": "forhims.com",
  "OKLO": "oklo.com",
  "LEU": "centrusenergy.com",
  "SMR": "nuscalepower.com",
  "NBIS": "nebius.com",
  "BTI": "bat.com",
  "MO": "altria.com",
  "PM": "pmi.com",
  "ABR": "arbor.com",
  "WPC": "wpcarey.com",
  "CVS": "cvshealth.com",
  "OSCR": "hioscar.com",
};

export function CompanyLogo({ ticker, companyName, size = "md", className = "" }: CompanyLogoProps) {
  const [logoIndex, setLogoIndex] = useState(0);
  
  const sizeClasses = {
    xs: "h-4 w-4",
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  const iconSizes = {
    xs: "h-2 w-2",
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const fullTicker = ticker.toUpperCase();
  const cleanTicker = fullTicker.split(".")[0];

  const getLogoUrls = (): string[] => {
    const urls: string[] = [];
    const domain = tickerToDomain[cleanTicker];

    if (domain) {
      urls.push(`https://img.logo.dev/${domain}?token=pk_X-1ZO13GSgeOoUrIuJ6GMQ`);
    }

    if (fullTicker !== cleanTicker) {
      urls.push(`https://images.financialmodelingprep.com/symbol/${fullTicker}.png`);
    }
    urls.push(`https://images.financialmodelingprep.com/symbol/${cleanTicker}.png`);

    urls.push(`https://assets.parqet.com/logos/symbol/${cleanTicker}`);

    urls.push(`https://img.logo.dev/ticker/${cleanTicker}?token=pk_X-1ZO13GSgeOoUrIuJ6GMQ`);

    if (!domain) {
      const guessedDomain = `${cleanTicker.toLowerCase()}.com`;
      urls.push(`https://img.logo.dev/${guessedDomain}?token=pk_X-1ZO13GSgeOoUrIuJ6GMQ`);
    }

    return urls;
  };
  
  const logoUrls = getLogoUrls();
  const currentLogoUrl = logoUrls[logoIndex];
  const hasMoreLogos = logoIndex < logoUrls.length - 1;
  
  const getFallbackInitials = (): string => {
    if (companyName) {
      const words = companyName.split(" ").filter(w => w.length > 0);
      if (words.length >= 2) {
        return (words[0][0] + words[1][0]).toUpperCase();
      }
      return companyName.substring(0, 2).toUpperCase();
    }
    return cleanTicker.substring(0, 2);
  };

  const handleError = () => {
    if (hasMoreLogos) {
      setLogoIndex(prev => prev + 1);
    }
  };

  const allLogosFailed = logoIndex >= logoUrls.length;

  return (
    <Avatar className={`${sizeClasses[size]} ${className}`} data-testid={`logo-${ticker}`}>
      {!allLogosFailed && currentLogoUrl && (
        <AvatarImage 
          src={currentLogoUrl} 
          alt={companyName || ticker}
          onError={handleError}
        />
      )}
      <AvatarFallback className="bg-muted text-muted-foreground text-xs font-medium">
        {allLogosFailed ? (
          <Building2 className={iconSizes[size]} />
        ) : (
          getFallbackInitials()
        )}
      </AvatarFallback>
    </Avatar>
  );
}
