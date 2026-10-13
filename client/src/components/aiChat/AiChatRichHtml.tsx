import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "isomorphic-dompurify";
import { createRoot, type Root } from "react-dom/client";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./ai-chat-rich.css";

const ALLOWED_TAGS = [
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "div",
  "span",
  "figure",
  "details",
  "summary",
  "cite",
  "a",
  "br",
];

const ALLOWED_ATTR = [
  "class",
  "href",
  "target",
  "rel",
  "data-t",
  "data-type",
  "data-src",
  "data-chart",
];

/** Move figure chart JSON into data-chart so DOMPurify can drop <script>. */
function preprocessCharts(html: string): string {
  return html.replace(
    /<figure([^>]*class=["'][^"']*chart[^"']*["'][^>]*)>([\s\S]*?)<\/figure>/gi,
    (_m, attrs, inner) => {
      const scriptMatch = String(inner).match(
        /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i,
      );
      const json = scriptMatch?.[1]?.trim() || "{}";
      const safe = json.replace(/"/g, "&quot;");
      const cleanedInner = String(inner).replace(/<script[\s\S]*?<\/script>/gi, "");
      if (/data-chart=/.test(attrs)) {
        return `<figure${attrs}>${cleanedInner}</figure>`;
      }
      return `<figure${attrs} data-chart="${safe}">${cleanedInner}</figure>`;
    },
  );
}

function wrapTables(html: string): string {
  return html.replace(/<table(\s[^>]*)?>[\s\S]*?<\/table>/gi, (m) => {
    const withClass = /class=/i.test(m)
      ? m
      : m.replace(/<table/i, '<table class="ai-table"');
    return `<div class="ai-table-wrap">${withClass}</div>`;
  });
}

function enhanceTickers(html: string): string {
  return html.replace(
    /<span([^>]*?)class=["']([^"']*?\bticker\b[^"']*)["']([^>]*?)data-t=["']([A-Za-z0-9.\-]+)["']([^>]*)>([\s\S]*?)<\/span>/gi,
    (_m, a1, cls, a2, ticker, a3, inner) =>
      `<a class="ai-ticker ${cls}" href="/asset/${encodeURIComponent(String(ticker).toUpperCase())}" data-t="${ticker}"${a1}${a2}${a3}>${inner}</a>`,
  );
}

function ChartMount({
  type,
  labels,
  values,
}: {
  type: "bar" | "line";
  labels: string[];
  values: number[];
}) {
  const data = labels.map((label, i) => ({
    label,
    value: Number(values[i]) || 0,
  }));
  if (type === "line") {
    return (
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data}>
          <XAxis dataKey="label" tick={{ fill: "#6B727C", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: "#1D2126",
              border: "1px solid #272C32",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Line type="monotone" dataKey="value" stroke="#B48CE0" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data}>
        <XAxis dataKey="label" tick={{ fill: "#6B727C", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          contentStyle={{
            background: "#1D2126",
            border: "1px solid #272C32",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Bar dataKey="value" fill="#B48CE0" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

type Props = {
  html: string;
  streaming?: boolean;
};

export function AiChatRichHtml({ html, streaming }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootsRef = useRef<Root[]>([]);

  const clean = useMemo(() => {
    const raw = wrapTables(enhanceTickers(preprocessCharts(html || "")));
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: true,
    });
  }, [html]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    rootsRef.current.forEach((r) => {
      try {
        r.unmount();
      } catch {
        /* ignore */
      }
    });
    rootsRef.current = [];

    host.querySelectorAll("figure.chart").forEach((fig) => {
      const el = fig as HTMLElement;
      const type = (el.getAttribute("data-type") || "bar") as "bar" | "line";
      let labels: string[] = [];
      let values: number[] = [];
      try {
        const raw = (el.getAttribute("data-chart") || "{}").replace(/&quot;/g, '"');
        const parsed = JSON.parse(raw);
        labels = Array.isArray(parsed.labels) ? parsed.labels.map(String) : [];
        values = Array.isArray(parsed.values) ? parsed.values.map(Number) : [];
      } catch {
        /* ignore */
      }
      const mount = document.createElement("div");
      mount.className = "ai-chart-react";
      el.innerHTML = "";
      el.appendChild(mount);
      const root = createRoot(mount);
      rootsRef.current.push(root);
      root.render(<ChartMount type={type === "line" ? "line" : "bar"} labels={labels} values={values} />);
    });

    const onTickerClick = (e: Event) => {
      const a = e.currentTarget as HTMLAnchorElement;
      const href = a.getAttribute("href");
      if (!href?.startsWith("/asset/")) return;
      e.preventDefault();
      window.history.pushState({}, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    };
    host.querySelectorAll("a.ai-ticker").forEach((a) => {
      a.addEventListener("click", onTickerClick);
    });

    return () => {
      host.querySelectorAll("a.ai-ticker").forEach((a) => {
        a.removeEventListener("click", onTickerClick);
      });
      rootsRef.current.forEach((r) => {
        try {
          r.unmount();
        } catch {
          /* ignore */
        }
      });
      rootsRef.current = [];
    };
  }, [clean]);

  return (
    <div
      ref={hostRef}
      className={`ai-chat-rich${streaming ? " streaming-caret" : ""}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
