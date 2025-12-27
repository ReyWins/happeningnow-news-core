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
const NEWSAPI_HARD_LIMIT = 15;
const NEWSAPI_MAX_KEYWORDS = 12;

function getEnvValue(name: string) {
  const metaEnv =
    typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, string> }).env : undefined;
  return (
    (typeof process !== "undefined" ? process.env?.[name] : undefined) ||
    metaEnv?.[name] ||
    ""
  );
}

function apiKey() {
  return (
    getEnvValue("NEWSAPI_AI_KEY") ||
    getEnvValue("NEWSAPI_KEY") ||
    getEnvValue("EVENTREGISTRY_API_KEY") ||
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
  return q.replace(/\bAND\b|\bOR\b/gi, " ").replace(/[()]/g, " ").trim();
}

function extractKeywordTerms(q: string) {
  const phrases: string[] = [];
  const remainder = q.replace(/"([^"]+)"/g, (_, phrase: string) => {
    phrases.push(cleanText(phrase));
    return " ";
  });
  const normalized = normalizeKeyword(remainder).replace(/[']/g, "");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return [...phrases, ...tokens]
    .map((term) => cleanText(term))
    .filter((term) => term && !/^(and|or)$/i.test(term));
}

function dedupeTerms(terms: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(term);
  }
  return output;
}

function capTerms(terms: string[]) {
  let trimmed = false;
  let capped = terms;
  if (capped.length > NEWSAPI_MAX_KEYWORDS) {
    capped = capped.slice(0, NEWSAPI_MAX_KEYWORDS);
    trimmed = true;
  }
  if (capped.length > NEWSAPI_HARD_LIMIT) {
    capped = capped.slice(0, NEWSAPI_HARD_LIMIT);
    trimmed = true;
  }
  return { terms: capped, trimmed };
}

function buildKeywordString(terms: string[]) {
  return terms
    .map((term) => (term.includes(" ") ? `"${term}"` : term))
    .join(" ")
    .trim();
}

function removeUnitedStates(terms: string[]) {
  return terms.filter((term) => term.toLowerCase() !== "united states");
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
    envAI: Boolean(getEnvValue("NEWSAPI_AI_KEY")),
    envKey: Boolean(getEnvValue("NEWSAPI_KEY")),
    envER: Boolean(getEnvValue("EVENTREGISTRY_API_KEY")),
  });
  const key = apiKey();
  console.info("[newsapi.ai/er] apiKey", Boolean(key));
  if (!key) {
    console.info("[newsapi.ai/er] missingKey", {
      envAI: Boolean(getEnvValue("NEWSAPI_AI_KEY")),
      envKey: Boolean(getEnvValue("NEWSAPI_KEY")),
      envER: Boolean(getEnvValue("EVENTREGISTRY_API_KEY")),
    });
    return { sections: [] };
  }

  const rawQuery = q?.trim() ? q.trim() : "United States";
  const baseTerms = dedupeTerms(extractKeywordTerms(rawQuery));
  const hasUnitedStatesIndex = baseTerms.findIndex(
    (term) => term.toLowerCase() === "united states"
  );
  if (hasUnitedStatesIndex > 0) {
    const [us] = baseTerms.splice(hasUnitedStatesIndex, 1);
    baseTerms.unshift(us);
  }
  const capped = capTerms(baseTerms);
  const keywordTerms = capped.terms;
  const keyword =
    buildKeywordString(keywordTerms) || buildKeywordString(baseTerms) || "news";
  const limit = 30;
  const lang = "eng";
  console.info("[newsapi.ai/er] rawQuery", rawQuery);
  console.info("[newsapi.ai/er] keyword", keyword);
  console.info("[newsapi.ai/er] keywordCount", keywordTerms.length);
  console.info("[newsapi.ai/er] keywords", keywordTerms);
  console.info("[newsapi.ai/er] queryString", keyword);
  console.info("[newsapi.ai/er] request", {
    keyword,
    lang,
    limit,
    trimmed: capped.trimmed,
  });

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

  if (!raw.length) {
    const retryTerms = capTerms(removeUnitedStates(baseTerms)).terms;
    const retryKeyword = buildKeywordString(retryTerms);
    if (retryKeyword && retryKeyword !== keyword) {
      console.info("[newsapi.ai/er] retryKeyword", retryKeyword);
      console.info("[newsapi.ai/er] retryKeywordCount", retryTerms.length);
      const retryPayload = {
        ...payload,
        keyword: retryKeyword,
      };
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
