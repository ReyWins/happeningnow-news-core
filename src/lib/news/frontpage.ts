import type { Edition, NewsAdapter, Section, Story } from "./types";
import { gdeltAdapter } from "./adapters/gdelt";
import { newsApiAdapter } from "./adapters/newsapi";
import { getCachedEdition } from "./cache";
import { CATEGORIES, DEFAULT_CATEGORY_IDS } from "../../data/categories";

const BASE_QUERY = "United States";
const NEWSAPI_MAX_KEYWORDS = 8;
const CATEGORY_QUERY_HINTS: Record<string, string[]> = {
  global: [
    "election",
    "congress",
    "white house",
    "diplomacy",
    "foreign policy",
    "senate",
  ],
  business: [
    "markets",
    "stocks",
    "earnings",
    "economy",
    "finance",
    "banking",
    "wall street",
  ],
  tech: [
    "technology",
    "tech",
    "ai",
    "software",
    "cloud",
    "startup",
    "semiconductor",
    "chip",
  ],
  cyber: [
    "cybersecurity",
    "breach",
    "ransomware",
    "malware",
    "hacking",
  ],
  energy: [
    "energy",
    "oil",
    "gas",
    "power",
    "grid",
    "electricity",
    "utility",
  ],
  science: [
    "science",
    "research",
    "nasa",
    "space",
    "climate",
    "study",
  ],
  health: [
    "health",
    "medical",
    "hospital",
    "vaccine",
    "public health",
    "cdc",
  ],
  sports: [
    "sports",
    "nfl",
    "nba",
    "mlb",
    "nhl",
    "soccer",
    "college",
  ],
  weather: [
    "weather",
    "storm",
    "hurricane",
    "tornado",
    "forecast",
  ],
  entertainment: [
    "entertainment",
    "movie",
    "tv",
    "music",
    "celebrity",
    "hollywood",
  ],
};

function normalizeCategoryIds(input: string[] = []) {
  const ids = input.map((id) => String(id).trim().toLowerCase()).filter(Boolean);
  const unique = Array.from(new Set(ids));
  const allowed = new Set(CATEGORIES.map((category) => category.id));
  return unique.filter((id) => allowed.has(id)).slice(0, 3);
}

function labelForCategory(id: string) {
  return CATEGORIES.find((category) => category.id === id)?.label ?? id;
}

function buildCategoryQuery(id: string, baseQuery = BASE_QUERY) {
  const hints = CATEGORY_QUERY_HINTS[id];
  const baseValue = String(baseQuery ?? "").trim();
  const label = labelForCategory(id);

  if (!hints?.length) {
    return [baseValue, label].filter(Boolean).join(" ").trim();
  }

  const normalized = hints.map((entry) =>
    entry.includes(" ") ? `"${entry}"` : entry
  );
  const base = baseValue.includes(" ") ? `"${baseValue}"` : baseValue;
  const clause = base || label;
  return clause
    ? `${clause} AND (${normalized.join(" OR ")})`
    : `(${normalized.join(" OR ")})`;
}

type CategoryQueryBuilder = (id: string, baseQuery: string) => string;

type CategoryAdapterEntry = {
  name: string;
  adapter: NewsAdapter;
  ttlMs?: number;
  minStories?: number;
  queryBuilder?: CategoryQueryBuilder;
};

function resolveCategoryQuery(
  builder: CategoryQueryBuilder | undefined,
  id: string,
  baseQuery: string
) {
  const raw = builder?.(id, baseQuery) ?? buildCategoryQuery(id, baseQuery);
  const trimmed = String(raw ?? "").trim();
  if (trimmed) return trimmed;
  return labelForCategory(id);
}

function countQueryKeywords(query: string) {
  if (!query) return 0;
  const groupMatch = query.match(/\((.*)\)/);
  const group = groupMatch?.[1] ?? query;
  return group.split(/\s+OR\s+/i).map((part) => part.trim()).filter(Boolean).length;
}

function selectNewsApiKeywords(id: string) {
  const hints = CATEGORY_QUERY_HINTS[id] ?? [];
  const phrases = hints.filter((entry) => entry.includes(" "));
  const singles = hints.filter((entry) => !entry.includes(" "));
  const ordered = [...phrases, ...singles];
  return ordered.slice(0, NEWSAPI_MAX_KEYWORDS);
}

function buildNewsApiQuery(id: string, baseQuery = BASE_QUERY) {
  const baseValue = String(baseQuery ?? "").trim();
  const keywords = selectNewsApiKeywords(id);
  if (!keywords.length) return baseValue;
  const normalized = keywords.map((entry) =>
    entry.includes(" ") ? `"${entry}"` : entry
  );
  const base = baseValue.includes(" ") ? `"${baseValue}"` : baseValue;
  return base ? `${base} AND (${normalized.join(" OR ")})` : `(${normalized.join(" OR ")})`;
}

async function getStoriesForCategory({
  id,
  baseQuery,
  ttlMs,
  adapters,
}: {
  id: string;
  baseQuery: string;
  ttlMs: number;
  adapters: CategoryAdapterEntry[];
}): Promise<Story[]> {
  for (const entry of adapters) {
    const q = resolveCategoryQuery(entry.queryBuilder, id, baseQuery);
    if (!q) continue;
    const cacheKey = `frontpage:${entry.name}:${id}:${q}`;
    const keywordCount = countQueryKeywords(q);
    console.info("[frontpage] selectedAdapter", {
      category: id,
      adapter: entry.name,
      query: q,
      cacheKey,
      keywordCount,
    });
    try {
      const edition = await getCachedEdition(
        cacheKey,
        entry.ttlMs ?? ttlMs,
        () => entry.adapter({ q })
      );
      const stories = edition.sections?.[0]?.stories ?? [];
      const fallbackReason =
        stories.length === 0
          ? "empty"
          : entry.minStories && stories.length < entry.minStories
            ? "below_min"
            : null;
      console.info("[frontpage] adapterResult", {
        category: id,
        adapter: entry.name,
        rawCount: edition.sections?.[0]?.stories?.length ?? 0,
        mappedCount: stories.length,
        fallbackReason,
      });
      if (stories.length && (!entry.minStories || stories.length >= entry.minStories)) {
        return stories;
      }
    } catch (err) {
      console.warn("[frontpage] adapterError", {
        category: id,
        adapter: entry.name,
        fallbackReason: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return [];
}

async function getStoriesFromMock({
  adapter,
  adapterName,
  baseQuery,
  ttlMs,
  id,
}: {
  adapter: NewsAdapter;
  adapterName: string;
  baseQuery: string;
  ttlMs: number;
  id: string;
}): Promise<Story[]> {
  const q = resolveCategoryQuery(undefined, id, baseQuery);
  const cacheKey = `frontpage:${adapterName}:${id}:${q}`;
  const edition = await getCachedEdition(cacheKey, ttlMs, () => adapter({ q }));
  return edition.sections?.[0]?.stories ?? [];
}

export async function getFrontPageEdition({
  adapter,
  adapterName,
  ttlMs,
  categoryIds = DEFAULT_CATEGORY_IDS,
  baseQuery = BASE_QUERY,
  fallbackTtlMs,
  fallbackQueryBuilder,
  categoryAdapters,
}: {
  adapter?: NewsAdapter;
  adapterName?: string;
  ttlMs: number;
  categoryIds?: string[];
  baseQuery?: string;
  fallbackTtlMs?: number;
  fallbackQueryBuilder?: (id: string, base: string) => string;
  categoryAdapters?: CategoryAdapterEntry[];
}): Promise<Edition> {
  const ids = normalizeCategoryIds(categoryIds);
  if (ids.length === 0) return { sections: [] };

  const fallbackAdapters =
    categoryAdapters ??
    [
      {
        name: "newsapi",
        adapter: newsApiAdapter,
        ttlMs: fallbackTtlMs ?? ttlMs,
        minStories: 3,
        queryBuilder: (id, base) =>
          fallbackQueryBuilder?.(id, base) ?? buildNewsApiQuery(id, base),
      },
      {
        name: "gdelt",
        adapter: gdeltAdapter,
        queryBuilder: buildCategoryQuery,
      },
    ];

  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const stories =
        adapterName === "mock" && adapter
          ? await getStoriesFromMock({
              adapter,
              adapterName,
              baseQuery,
              ttlMs,
              id,
            })
          : await getStoriesForCategory({
              id,
              baseQuery,
              ttlMs,
              adapters: fallbackAdapters,
            });
      return { id, stories };
    })
  );

  const sections: Section[] = results.map((result, idx) => {
    const id = ids[idx];
    const label = labelForCategory(id);
    if (result.status === "fulfilled") {
      return { label, stories: result.value.stories };
    }
    return { label, stories: [] };
  });

  return { sections };
}
