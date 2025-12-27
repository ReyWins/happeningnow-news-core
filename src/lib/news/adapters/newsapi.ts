import type { Edition, NewsAdapter, Section, Story } from "../types";

type ErArticle = {
  uri?: string;
  url?: string;
  title?: string;
  body?: string;
  dateTime?: string;
  dateTimePub?: string;
  image?: string;
  source?: {
    title?: string;
    uri?: string;
  };
};

type ErResponse = {
  articles?: {
    results?: ErArticle[];
    totalResults?: number;
    page?: number;
    pages?: number;
  };
  error?: string;
  errorDescr?: string;
};

const EVENTREGISTRY_ENDPOINT = "https://eventregistry.org/api/v1/article/getArticles";
const ER_CACHE_TTL_MS = 30 * 60 * 1000;
const ER_MAX_KEYWORDS = 12;
const erCache = new Map<string, { value: Edition; expiresAt: number }>();

function apiKey() {
  return (
    process.env.NEWSAPI_AI_KEY ||
    process.env.NEWSAPI_KEY ||
    process.env.EVENTREGISTRY_API_KEY ||
    ""
  );
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function pickDate(article: ErArticle) {
  return article.dateTimePub || article.dateTime || "";
}

function extractKeywords(query: string) {
  if (!query) return [];
  const groupMatch = query.match(/\((.*)\)/);
  const group = groupMatch?.[1] ?? "";
  return group
    .split(/\s+OR\s+/i)
    .map((part) => part.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

function quoteTerm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.includes(" ") ? `"${trimmed}"` : trimmed;
}

function buildErKeywordQuery(rawQuery: string, limit = ER_MAX_KEYWORDS) {
  const trimmed = rawQuery.trim();
  if (!trimmed) return { erQuery: trimmed, keywords: [], base: "" };
  const baseMatch = trimmed.match(/^(.*?)\s+AND\s+\(/i);
  const base = baseMatch?.[1]?.trim() ?? "";
  let keywords = extractKeywords(trimmed).map((entry) => entry.trim()).filter(Boolean);
  keywords = Array.from(new Set(keywords));
  const limited = keywords.slice(0, limit);
  const terms = [base, ...limited].filter(Boolean).map(quoteTerm);
  const erQuery = terms.join(" ");
  return { erQuery: erQuery || trimmed, keywords: limited, base };
}

function toEventRegistryKeyword(q: string) {
  return String(q ?? "")
    .replace(/\bAND\b|\bOR\b/gi, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCacheKey(q: string, limit: number, lang: string, key: string) {
  return `er:key=${key}|q=${q}|limit=${limit}|lang=${lang}`;
}

async function postEventRegistry(payload: unknown) {
  const res = await fetch(EVENTREGISTRY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  let json: ErResponse = {};
  try {
    json = (await res.json()) as ErResponse;
  } catch {
    json = {};
  }

  return { res, json };
}

export const newsApiAdapter: NewsAdapter = async ({ q } = {}) => {
  const key = apiKey();
  console.info("[newsapi.ai/er] apiKey", Boolean(key));
  if (!key) return { sections: [] };

  const rawQuery = q?.trim() ? q.trim() : "United States";
  const keywordQuery = toEventRegistryKeyword(rawQuery);
  const { erQuery: query, keywords, base } = buildErKeywordQuery(
    keywordQuery,
    ER_MAX_KEYWORDS
  );
  const limit = 30;
  const lang = "eng";
  const keywordCount = keywords.length;
  console.info("[newsapi.ai/er] keywordCount", keywordCount, "keywords", keywords);
  console.info("[newsapi.ai/er] queryMode", { rawQuery, keywordQuery, base, query });
  console.info("[newsapi.ai/er] queryString", query);
  console.info("[newsapi.ai/er] request", { query, lang, limit, keywordCount });

  const cacheKey = buildCacheKey(query, limit, lang, key);
  const cached = erCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const payload = {
    apiKey: key,
    action: "getArticles",
    resultType: "articles",
    articlesPage: 1,
    articlesCount: limit,
    query: {
      $query: {
        $and: [{ keyword: query }, { lang: "eng" }],
      },
    },
  };
  console.info("[newsapi.ai/er] requestBody", {
    action: payload.action,
    resultType: payload.resultType,
    articlesPage: payload.articlesPage,
    articlesCount: payload.articlesCount,
    query: payload.query,
  });

  let { res, json } = await postEventRegistry(payload);
  console.info("[newsapi.ai/er] status", res.status, res.statusText);
  if (!res.ok || json?.error || json?.errorDescr) {
    console.warn("[newsapi.ai/er] error", json?.error, json?.errorDescr);
    return { sections: [] };
  }

  let raw = json?.articles?.results ?? [];
  console.info("[newsapi.ai/er] articles", {
    returned: raw.length,
    total: json?.articles?.totalResults ?? null,
  });

  if (!raw.length && base) {
    const fallbackTerms = keywords.map(quoteTerm);
    const fallbackQuery = fallbackTerms.join(" ");
    if (fallbackQuery) {
      const retryPayload = {
        ...payload,
        query: {
          $query: {
            $and: [{ keyword: fallbackQuery }, { lang: "eng" }],
          },
        },
      };
      console.info("[newsapi.ai/er] retryQuery", fallbackQuery);
      ({ res, json } = await postEventRegistry(retryPayload));
      console.info("[newsapi.ai/er] retryStatus", res.status, res.statusText);
      if (!res.ok || json?.error || json?.errorDescr) {
        console.warn("[newsapi.ai/er] retryError", json?.error, json?.errorDescr);
        return { sections: [] };
      }
      raw = json?.articles?.results ?? [];
      console.info("[newsapi.ai/er] retryArticles", {
        returned: raw.length,
        total: json?.articles?.totalResults ?? null,
      });
    }
  }

  const stories: Story[] = raw.map((article, idx) => {
    const url = article.url ?? "";
    const title = cleanText(article.title ?? "Untitled");
    const source = cleanText(article.source?.title ?? "NewsAPI.ai");
    const publishDate = pickDate(article);
    const imageUrl = article.image ?? "";
    const popularity = Math.max(0, Math.min(100, 100 - idx));

    return {
      id: url ? `newsapi:${url}` : `newsapi:${article.uri ?? idx}`,
      source,
      kicker: "Featured",
      title,
      summary: "",
      url,
      imageUrl,
      imageFloat: "right",
      publishDate,
      popularity,
    };
  });

  const edition: Edition = { sections: [{ label: "Featured", stories }] };
  console.info("[newsapi.ai/er] mapped", stories.length);
  erCache.set(cacheKey, { value: edition, expiresAt: now + ER_CACHE_TTL_MS });
  return edition;
};
