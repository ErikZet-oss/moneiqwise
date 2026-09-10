import { getSmtpConfig } from "../aiBot/mailer";

export async function sendPaperBotEmail(input: {
  to: string;
  subject: string;
  body: string;
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

    await transporter.sendMail({
      from: cfg.from,
      to,
      subject: input.subject,
      text: `${input.body}\n\n—\nMoneiqwise Paper Bot`,
    });
    return "sent";
  } catch (err) {
    console.warn("[paper-bot] email failed:", err);
    return "failed";
  }
}

export async function notifyPaperBotEvent(input: {
  enabled: boolean;
  email: string | null;
  botName: string;
  event: "open" | "close" | "kill";
  message: string;
}): Promise<void> {
  if (!input.enabled || !input.email) return;
  const label =
    input.event === "open"
      ? "OPEN"
      : input.event === "close"
        ? "CLOSE"
        : "KILL";
  await sendPaperBotEmail({
    to: input.email,
    subject: `[Moneiqwise Paper] ${label}: ${input.botName}`,
    body: input.message,
  });
}
