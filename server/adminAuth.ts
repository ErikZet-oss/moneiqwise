/**
 * Admin rozhranie pre schvaľovanie registrácií — emaily z LOCAL_AUTH_ADMIN_EMAILS (čiarkou oddelené).
 */

export function parseAdminEmailSet(): Set<string> | null {
  const raw = process.env.LOCAL_AUTH_ADMIN_EMAILS;
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  if (entries.length === 0) return null;
  return new Set(entries);
}

export function isRegistrationAdminEmail(email: string | null | undefined): boolean {
  const set = parseAdminEmailSet();
  if (!set || !email) return false;
  return set.has(email.trim().toLowerCase());
}
