import type { AiBotAlert } from "./alertsStore";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "";
  if (!host || !user || !pass || !from) return null;
  const port = Number(process.env.SMTP_PORT || "587");
  const secure =
    process.env.SMTP_SECURE === "1" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user,
    pass,
    from,
  };
}

export function isSmtpConfigured(): boolean {
  return getSmtpConfig() != null;
}

/**
 * Pošle alert e-mail. Vráti status bez throw — volajúci len uloží flag.
 * Ak chýba SMTP, vráti skipped_no_smtp (UI: „e-mail pripravený po nastavení SMTP“).
 */
export async function sendAlertEmail(input: {
  to: string;
  alert: Pick<AiBotAlert, "ticker" | "kind" | "title" | "body" | "changePct">;
}): Promise<"sent" | "skipped_no_smtp" | "failed"> {
  const cfg = getSmtpConfig();
  if (!cfg) return "skipped_no_smtp";

  const to = String(input.to || "").trim();
  if (!to || !to.includes("@")) return "failed";

  try {
    const nodemailerMod = await import("nodemailer");
    const createTransport =
      nodemailerMod.createTransport ??
      (nodemailerMod as { default?: { createTransport: typeof nodemailerMod.createTransport } })
        .default?.createTransport;
    if (!createTransport) return "failed";

    const transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
    });

    const kindLabel = input.alert.kind === "price" ? "Cena" : "Novinka";
    const change =
      input.alert.changePct != null
        ? ` (${input.alert.changePct > 0 ? "+" : ""}${input.alert.changePct.toFixed(1)} %)`
        : "";
    const subject = `[Moneiqwise] ${kindLabel}: ${input.alert.ticker}${change}`;
    const text = [
      input.alert.title,
      "",
      input.alert.body,
      "",
      "—",
      "Moneiqwise AI Alerty",
    ].join("\n");

    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
    });
    return "sent";
  } catch (err) {
    console.warn("[ai-alerts] email send failed:", err);
    return "failed";
  }
}
