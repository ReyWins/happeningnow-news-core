export function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase();
}

export function sanitizeQuery(input: unknown, minLength = 2, maxLength = 25) {
  const query = String(input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const valid = query.length >= minLength && query.length <= maxLength;
  return { query, valid };
}

export function matchesQuery(haystack: string, query?: string) {
  const q = normalizeText(query).trim();
  if (!q) return true;
  return normalizeText(haystack).includes(q);
}
