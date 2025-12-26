import type { Edition } from "./types";

type CacheEntry = {
  expiresAt: number;
  value?: Edition;
  promise?: Promise<Edition>;
};

const cache = new Map<string, CacheEntry>();

export async function getCachedEdition(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<Edition>
) {
  const now = Date.now();
  const existing = cache.get(key);

  if (existing) {
    if (existing.value && existing.expiresAt > now) return existing.value;
    if (existing.promise) return existing.promise;
    cache.delete(key);
  }

  const promise = fetcher()
    .then((value) => {
      cache.set(key, { value, expiresAt: now + ttlMs });
      return value;
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });

  cache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}
