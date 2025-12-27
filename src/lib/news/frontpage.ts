import type { Edition, NewsAdapter, Section, Story } from "./types";
import { gdeltAdapter } from "./adapters/gdelt";
import { newsApiAdapter } from "./adapters/newsapi";
import { getCachedEdition } from "./cache";
import { CATEGORIES, DEFAULT_CATEGORY_IDS } from "../../data/categories";

const BASE_QUERY = "United States";
const NEWSAPI_HARD_LIMIT = 15;
const NEWSAPI_MAX_KEYWORDS = 12;
const GDELT_MAX_KEYWORDS = 20;
const GDELT_FALLBACK_KEYWORDS = 6;
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

function getCategoryKeywords(id: string) {
  const category = CATEGORIES.find((entry) => entry.id === id);
  const keywords = category?.keywords?.length ? category.keywords : null;
  if (keywords?.length) return keywords;
  return CATEGORY_QUERY_HINTS[id] ?? [];
}

function buildCategoryQuery(id: string, baseQuery = BASE_QUERY) {
  const hints = getCategoryKeywords(id);
  const baseValue = String(baseQuery ?? "").trim();
  const label = labelForCategory(id);

  if (!hints?.length) {
    return [baseValue, label].filter(Boolean).join(" ").trim();
  }

  const trimmedHints = hints.slice(0, GDELT_MAX_KEYWORDS);
  const normalized = trimmedHints.map((entry) =>
    entry.includes(" ") ? `"${entry}"` : entry
  );
  const base = baseValue.includes(" ") ? `"${baseValue}"` : baseValue;
  const clause = base || label;
  return clause
    ? `${clause} AND (${normalized.join(" OR ")})`
    : `(${normalized.join(" OR ")})`;
}

function buildGdeltFallbackQuery(id: string, baseQuery = "") {
  const hints = getCategoryKeywords(id);
  const label = labelForCategory(id);
  if (!hints?.length) return label;
  const trimmedHints = hints.slice(0, GDELT_FALLBACK_KEYWORDS);
  const normalized = trimmedHints.map((entry) =>
    entry.includes(" ") ? `"${entry}"` : entry
  );
  const baseValue = String(baseQuery ?? "").trim();
  if (!baseValue) return `(${normalized.join(" OR ")})`;
  return `${baseValue} AND (${normalized.join(" OR ")})`;
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
  let keywords = Array.from(
    new Set(ordered.map((entry) => entry.trim()).filter(Boolean))
  );
  if (keywords.length > NEWSAPI_MAX_KEYWORDS) {
    keywords = keywords.slice(0, NEWSAPI_MAX_KEYWORDS);
  }
  if (keywords.length > NEWSAPI_HARD_LIMIT) {
    keywords = keywords.slice(0, NEWSAPI_HARD_LIMIT);
  }
  return keywords;
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

function storyMatchesCategory(story: Story, id: string) {
  const category = CATEGORIES.find((entry) => entry.id === id);
  const keywords = category?.keywords?.length ? category.keywords : CATEGORY_QUERY_HINTS[id] ?? [];
  const domains = category?.domainsPreferred ?? category?.domains ?? [];
  const url = String(story?.url ?? "");
  const domain = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();
  if (domains.length && domain) {
    const match = domains.some(
      (entry) => domain === entry || domain.endsWith(`.${entry}`)
    );
    if (match) return true;
  }
  if (!keywords.length) return true;
  const hay = `${story?.title ?? ""} ${story?.summary ?? ""} ${story?.source ?? ""} ${story?.url ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  return keywords.some((keyword) => {
    const needle = String(keyword ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!needle) return false;
    if (needle.includes(" ")) return hay.includes(needle);
    return hay.split(" ").includes(needle);
  });
}

async function getMixedStoriesForCategory({
  id,
  baseQuery,
  ttlMs,
  newsapiTtlMs,
  gdeltTtlMs,
}: {
  id: string;
  baseQuery: string;
  ttlMs: number;
  newsapiTtlMs?: number;
  gdeltTtlMs?: number;
}): Promise<Story[]> {
  const newsApiQuery = resolveCategoryQuery(buildNewsApiQuery, id, "");
  const gdeltQuery = resolveCategoryQuery(buildCategoryQuery, id, baseQuery);
  const newsApiCacheKey = `frontpage:newsapi-top:${id}:${newsApiQuery}`;
  const gdeltCacheKey = `frontpage:gdelt:${id}:${gdeltQuery}`;

  const newsApiEdition = await getCachedEdition(
    newsApiCacheKey,
    newsapiTtlMs ?? ttlMs,
    () => newsApiAdapter({ q: newsApiQuery })
  );
  const candidateNewsApiStory =
    newsApiEdition.sections?.[0]?.stories?.[0] ?? null;
  const newsApiStory =
    candidateNewsApiStory && storyMatchesCategory(candidateNewsApiStory, id)
      ? candidateNewsApiStory
      : null;
  const featuredStory = newsApiStory
    ? {
        ...newsApiStory,
        featured: true,
        popularity: Math.max(100, Number(newsApiStory.popularity) || 0),
      }
    : null;

  const gdeltEdition = await getCachedEdition(
    gdeltCacheKey,
    gdeltTtlMs ?? ttlMs,
    () => gdeltAdapter({ q: gdeltQuery })
  );
  let gdeltStories = gdeltEdition.sections?.[0]?.stories ?? [];
  if (!gdeltStories.length) {
    const fallbackQuery = buildGdeltFallbackQuery(id, "");
    const fallbackCacheKey = `frontpage:gdelt-fallback:${id}:${fallbackQuery}`;
    const fallbackEdition = await getCachedEdition(
      fallbackCacheKey,
      gdeltTtlMs ?? ttlMs,
      () => gdeltAdapter({ q: fallbackQuery })
    );
    gdeltStories = fallbackEdition.sections?.[0]?.stories ?? [];
    console.info("[frontpage] gdeltFallback", {
      category: id,
      query: fallbackQuery,
      count: gdeltStories.length,
    });
  }
  const filteredGdelt = gdeltStories.filter((story) => storyMatchesCategory(story, id));
  const filteredNewsApi =
    featuredStory && storyMatchesCategory(featuredStory, id)
      ? [featuredStory]
      : [];
  const mixedStories = filteredNewsApi.length
    ? [...filteredNewsApi, ...filteredGdelt.filter((s) => s.id !== filteredNewsApi[0].id)]
    : filteredGdelt;

  console.info("[frontpage] mixedResult", {
    category: id,
    newsapiCount: newsApiStory ? 1 : 0,
    gdeltCount: gdeltStories.length,
    total: mixedStories.length,
  });

  return mixedStories;
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
          : adapterName === "newsapi"
            ? await getMixedStoriesForCategory({
                id,
                baseQuery,
                ttlMs,
                newsapiTtlMs: ttlMs,
                gdeltTtlMs: fallbackTtlMs ?? ttlMs,
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
      const stories = result.value.stories.map((story) => ({
        ...story,
        kicker: label,
      }));
      return { label, stories };
    }
    return { label, stories: [] };
  });

  return { sections };
}
