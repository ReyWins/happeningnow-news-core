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


function normalizeKeyword(q: string) {
  return q
    .replace(/\bAND\b|\bOR\b/gi, " ")
    .replace(/[()"']/g, "")
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

  console.info("[newsapi.ai/er] top keys", Object.keys(json));
  console.info(
    "[newsapi.ai/er] results length",
    json?.articles?.results?.length
  );

  return { res, json };
}

export const newsApiAdapter: NewsAdapter = async ({ q } = {}) => {
  console.info("[newsapi.ai/er] entered", {
    hasQ: Boolean(q),
    envAI: Boolean(process.env.NEWSAPI_AI_KEY),
    envKey: Boolean(process.env.NEWSAPI_KEY),
    envER: Boolean(process.env.EVENTREGISTRY_API_KEY),
  });
  const key = apiKey();
  console.info("[newsapi.ai/er] apiKey", Boolean(key));
  if (!key) {
    console.info("[newsapi.ai/er] missingKey", {
      envAI: Boolean(process.env.NEWSAPI_AI_KEY),
      envKey: Boolean(process.env.NEWSAPI_KEY),
      envER: Boolean(process.env.EVENTREGISTRY_API_KEY),
    });
    return { sections: [] };
  }

  const rawQuery = q?.trim() ? q.trim() : "United States";
  const keyword = normalizeKeyword(rawQuery);
  const limit = 30;
  const lang = "eng";
  console.info("[newsapi.ai/er] rawQuery", rawQuery);
  console.info("[newsapi.ai/er] keyword", keyword);
  console.info("[newsapi.ai/er] queryString", keyword);
  console.info("[newsapi.ai/er] request", { keyword, lang, limit });

  const cacheKey = buildCacheKey(keyword, limit, lang, key);
  const cached = erCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const payload = {
    apiKey: key,
    action: "getArticles",
    keyword: keyword,
    lang: "eng",
    articlesCount: limit,
  };
  console.info("[newsapi.ai/er] requestBody", payload);

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
