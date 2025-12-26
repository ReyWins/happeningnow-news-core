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

  const query = q?.trim() ? q.trim() : "United States";
  const limit = 30;
  const lang = "eng";
  console.info("[newsapi.ai/er] request", { query, lang, limit });

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

  const { res, json } = await postEventRegistry(payload);
  console.info("[newsapi.ai/er] status", res.status, res.statusText);
  if (!res.ok || json?.error || json?.errorDescr) {
    console.warn("[newsapi.ai/er] error", json?.error, json?.errorDescr);
    return { sections: [] };
  }

  const raw = json?.articles?.results ?? [];
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
