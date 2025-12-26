import type { AdapterQuery, Edition, NewsAdapter, Section, Story } from "../types";

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  sourcecountry?: string;
  domain?: string;
  language?: string;
  socialimage?: string;
  sourcecommonname?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

const US_ONLY = process.env.GDELT_US_ONLY !== "false";
const HALF_LIFE_HOURS = 8;
// Preferred domains boost scoring, but are not required for US-only gating.
const PREFERRED_DOMAINS = [
  // National + wire
  "apnews.com",
  "reuters.com",
  "axios.com",
  "npr.org",
  "pbs.org",
  "usatoday.com",
  "politico.com",
  "thehill.com",
  "c-span.org",
  "abcnews.go.com",
  "abcnews.com",
  "cbsnews.com",
  "nbcnews.com",
  "cnn.com",
  "foxnews.com",
  "newsweek.com",
  "time.com",
  "theatlantic.com",
  "newyorker.com",
  "foreignpolicy.com",
  "csmonitor.com",
  // Opinion + politics
  "semafor.com",
  "huffpost.com",
  "thedailybeast.com",
  "dailycaller.com",
  "breitbart.com",
  "theintercept.com",
  "motherjones.com",
  "thenation.com",
  "nationalreview.com",
  "newrepublic.com",
  "nymag.com",
  "newsmax.com",
  "rawstory.com",
  "reason.com",
  "salon.com",
  "vanityfair.com",
  "thewrap.com",
  "worldofreel.com",
  "showbiz411.com",
  "rollcall.com",
  "stateline.org",
  // Business + finance
  "bloomberg.com",
  "wsj.com",
  "marketwatch.com",
  "barrons.com",
  "forbes.com",
  "fortune.com",
  "businessinsider.com",
  "investopedia.com",
  "seekingalpha.com",
  "fool.com",
  "thestreet.com",
  "nasdaq.com",
  "finance.yahoo.com",
  "cnbc.com",
  "foxbusiness.com",
  "bizjournals.com",
  "bankrate.com",
  "kiplinger.com",
  "morningstar.com",
  // Energy + utilities
  "energy.gov",
  "eia.gov",
  "oilprice.com",
  "utilitydive.com",
  "renewableenergyworld.com",
  "greentechmedia.com",
  "powermag.com",
  "rigzone.com",
  // Tech
  "theverge.com",
  "cnet.com",
  "techcrunch.com",
  "wired.com",
  "arstechnica.com",
  "engadget.com",
  "gizmodo.com",
  "pcmag.com",
  "zdnet.com",
  "venturebeat.com",
  "thenextweb.com",
  "tomshardware.com",
  "tomsguide.com",
  "androidcentral.com",
  "9to5mac.com",
  "9to5google.com",
  "macrumors.com",
  "techradar.com",
  "bgr.com",
  "pcworld.com",
  "computerworld.com",
  "infoworld.com",
  "networkworld.com",
  "cio.com",
  "techrepublic.com",
  "digitaltrends.com",
  "geekwire.com",
  "siliconangle.com",
  "anandtech.com",
  "slashdot.org",
  "theinformation.com",
  // Cybersecurity
  "bleepingcomputer.com",
  "krebsonsecurity.com",
  "thehackernews.com",
  "darkreading.com",
  "securityweek.com",
  "therecord.media",
  "csoonline.com",
  "cyberscoop.com",
  "threatpost.com",
  // Science + space
  "sciencemag.org",
  "scientificamerican.com",
  "space.com",
  "sciencenews.org",
  "sciencedaily.com",
  "livescience.com",
  "science.org",
  "nasa.gov",
  "phys.org",
  // Health
  "cdc.gov",
  "nih.gov",
  "statnews.com",
  "healthline.com",
  "webmd.com",
  "medscape.com",
  "medicalnewstoday.com",
  "kff.org",
  // Sports
  "espn.com",
  "cbssports.com",
  "nbcsports.com",
  "foxsports.com",
  "si.com",
  "bleacherreport.com",
  "sports.yahoo.com",
  // Weather
  "weather.com",
  "weather.gov",
  "noaa.gov",
  "accuweather.com",
  // Entertainment
  "variety.com",
  "hollywoodreporter.com",
  "deadline.com",
  "ew.com",
  "rollingstone.com",
  "billboard.com",
  "people.com",
  "tmz.com",
  "eonline.com",
  "vulture.com",
  // Regional + metro
  "nytimes.com",
  "nydailynews.com",
  "nypost.com",
  "washingtonpost.com",
  "latimes.com",
  "chicagotribune.com",
  "suntimes.com",
  "chicago.suntimes.com",
  "sfchronicle.com",
  "sfgate.com",
  "boston.com",
  "bostonglobe.com",
  "bostonherald.com",
  "dailynews.com",
  "dallasnews.com",
  "freep.com",
  "seattletimes.com",
  "miamiherald.com",
  "denverpost.com",
  "ajc.com",
  "startribune.com",
  "inquirer.com",
  "houstonchronicle.com",
  "stltoday.com",
  "cleveland.com",
  "azcentral.com",
  "sacbee.com",
  "kansas.com",
  "newsday.com",
  "post-gazette.com",
];

const US_SOURCE_HINTS = new Set([
  // National + wire
  "ap",
  "associatedpress",
  "abcnews",
  "cbsnews",
  "cspan",
  "c-span",
  "cnn",
  "nbcnews",
  "foxnews",
  "npr",
  "pbs",
  "usatoday",
  "politico",
  "thehill",
  "reuters",
  "newsweek",
  "time",
  "atlantic",
  "theatlantic",
  "newyorker",
  "foreignpolicy",
  "csmonitor",
  // Business + finance
  "bloomberg",
  "wsj",
  "wallstreetjournal",
  "marketwatch",
  "barrons",
  "forbes",
  "fortune",
  "businessinsider",
  "investopedia",
  "seekingalpha",
  "motleyfool",
  "thestreet",
  "nasdaq",
  "yahoofinance",
  "cnbc",
  "foxbusiness",
  "bizjournals",
  "bankrate",
  "kiplinger",
  "morningstar",
  // Energy + utilities
  "energygov",
  "eia",
  "oilprice",
  "utilitydive",
  "renewableenergyworld",
  "greentechmedia",
  "powermag",
  "rigzone",
  // Tech
  "theverge",
  "cnet",
  "techcrunch",
  "wired",
  "arstechnica",
  "engadget",
  "gizmodo",
  "pcmag",
  "zdnet",
  "venturebeat",
  "thenextweb",
  "tomshardware",
  "tomsguide",
  "androidcentral",
  "9to5mac",
  "9to5google",
  "macrumors",
  "techradar",
  "bgr",
  "pcworld",
  "computerworld",
  "infoworld",
  "networkworld",
  "cio",
  "techrepublic",
  "digitaltrends",
  "geekwire",
  "siliconangle",
  "anandtech",
  "slashdot",
  "theinformation",
  // Cybersecurity
  "bleepingcomputer",
  "krebsonsecurity",
  "thehackernews",
  "darkreading",
  "securityweek",
  "therecord",
  "csoonline",
  "cyberscoop",
  "threatpost",
  // Science + space
  "sciencemag",
  "scientificamerican",
  "space",
  "sciencenews",
  "sciencedaily",
  "livescience",
  "science",
  "nasa",
  "phys",
  // Health
  "cdc",
  "nih",
  "statnews",
  "healthline",
  "webmd",
  "medscape",
  "medicalnewstoday",
  "kff",
  // Sports
  "espn",
  "cbssports",
  "nbcsports",
  "foxsports",
  "sportsillustrated",
  "bleacherreport",
  "yahoosports",
  // Weather
  "weather",
  "noaa",
  "accuweather",
  // Entertainment
  "variety",
  "hollywoodreporter",
  "deadline",
  "entertainmentweekly",
  "ew",
  "rollingstone",
  "billboard",
  "people",
  "tmz",
  "eonline",
  "vulture",
  "showbiz411",
  "worldofreel",
  // Regional + metro
  "nytimes",
  "newyorktimes",
  "washingtonpost",
  "latimes",
  "bostonglobe",
  "bostonherald",
  "boston",
  "chicagotribune",
  "suntimes",
  "sfchronicle",
  "sfgate",
  "dallasnews",
  "seattletimes",
  "miamiherald",
  "denverpost",
  "ajc",
  "startribune",
  "inquirer",
  "houstonchronicle",
  "stltoday",
  "cleveland",
  "azcentral",
  "sacbee",
  "kansas",
  "newsday",
  "postgazette",
  // Opinion + magazines
  "motherjones",
  "thenation",
  "nationalreview",
  "breitbart",
  "newrepublic",
  "newyork",
  "nymag",
  "newsmax",
  "reason",
  "salon",
  "vanityfair",
  "thewrap",
  // Misc
  "dailybeast",
  "dailycaller",
  "mediaite",
  "rawstory",
  "stateline",
  "rollcall",
  "semafor",
  "huffingtonpost",
  "huffpost",
  "intercept",
  "theintercept",
  "crazydaysandnights",
  "freepress",
  "freep",
  "elnuevodia",
  "ladailynews",
  "nydailynews",
  "nypost",
]);
const SUMMARY_CACHE_TTL_MS = 15 * 60 * 1000;
const SUMMARY_FETCH_TIMEOUT_MS = 1_500;
const SUMMARY_MAX_LENGTH = 220;
const SUMMARY_ENRICH_LIMIT = 4;
const SUMMARY_RANGE_BYTES = 60_000;
const summaryCache = new Map<string, { value: string; expiresAt: number }>();

function normalizeKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeTitle(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsTld(domain = "") {
  const clean = domain.toLowerCase().trim();
  if (!clean) return false;
  return clean.endsWith(".us");
}

function isPreferredDomain(domain = "") {
  const clean = domain.toLowerCase().trim();
  if (!clean) return false;
  return PREFERRED_DOMAINS.some(
    (suffix) => clean === suffix || clean.endsWith(`.${suffix}`)
  );
}

function isUsArticle(article: GdeltArticle) {
  const country = String(article.sourcecountry ?? "").toLowerCase();
  if (country === "us" || country === "usa" || country.includes("united states")) return true;
  const domain = article.domain ?? "";
  if (isUsTld(domain)) return true;
  const sourceKey = normalizeKey(article.sourcecommonname ?? "");
  return US_SOURCE_HINTS.has(sourceKey);
}

function isEnglishArticle(article: GdeltArticle) {
  const language = String(article.language ?? "").toLowerCase();
  return language === "english" || language.startsWith("en");
}

function getAgeHours(iso = "") {
  const ms = iso ? new Date(iso).getTime() : 0;
  if (!Number.isFinite(ms) || ms <= 0) return Number.POSITIVE_INFINITY;
  const ageMs = Math.max(0, Date.now() - ms);
  return ageMs / (1000 * 60 * 60);
}

function getSourceScore(article: GdeltArticle) {
  const sourceKey = normalizeKey(article.sourcecommonname ?? "");
  if (US_SOURCE_HINTS.has(sourceKey)) return 1;
  const domain = article.domain ?? "";
  if (isPreferredDomain(domain)) return 0.8;
  if (isUsTld(domain)) return 0.7;
  return 0.4;
}

function computePopularity(
  article: GdeltArticle,
  titleCounts: Map<string, number>
) {
  const ageHours = getAgeHours(article.seendate ?? "");
  const recency = Number.isFinite(ageHours)
    ? Math.exp(-ageHours / HALF_LIFE_HOURS)
    : 0;

  const titleKey = normalizeTitle(article.title ?? "");
  const clusterCount = titleKey ? titleCounts.get(titleKey) ?? 1 : 1;
  const clusterScore = Math.min(1, Math.max(0, (clusterCount - 1) / 4));
  const sourceScore = getSourceScore(article);

  const score = 100 * (0.6 * recency + 0.25 * clusterScore + 0.15 * sourceScore);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function decodeEntities(value = "") {
  const numericDecoded = value
    .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);?/g, (_, num) =>
      String.fromCharCode(parseInt(num, 10))
    );
  return numericDecoded
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]+/g, " ");
}

function extractMetaDescription(html = "") {
  const candidates = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']twitter:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ];
  for (const re of candidates) {
    const match = html.match(re);
    if (match?.[1]) {
      return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function trimSummary(summary = "") {
  const clean = summary.replace(/\s+/g, " ").trim();
  if (clean.length <= SUMMARY_MAX_LENGTH) return clean;
  return `${clean.slice(0, SUMMARY_MAX_LENGTH).trim()}…`;
}

function pickBestStory(a: Story, b: Story) {
  const score = (story: Story) => {
    const base = Number(story?.popularity) || 0;
    const image = story?.imageUrl ? 6 : 0;
    const summary = story?.summary ? 2 : 0;
    return base + image + summary;
  };
  return score(b) > score(a) ? b : a;
}

function getStoryDayKey(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dedupeStories(stories: Story[]) {
  const byKey = new Map<string, { story: Story; index: number }>();
  const ordered: Story[] = [];

  stories.forEach((story) => {
    const titleKey = normalizeTitle(story?.title ?? "");
    const dayKey = getStoryDayKey(story?.publishDate ?? "");
    const key = dayKey ? `${titleKey}:${dayKey}` : titleKey;
    if (!key) {
      ordered.push(story);
      return;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { story, index: ordered.length });
      ordered.push(story);
      return;
    }
    const chosen = pickBestStory(existing.story, story);
    if (chosen !== existing.story) {
      ordered[existing.index] = chosen;
      byKey.set(key, { story: chosen, index: existing.index });
    }
  });

  return ordered;
}

async function fetchSummary(url = "") {
  if (!url) return "";
  const cached = summaryCache.get(url);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUMMARY_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Range: `bytes=0-${SUMMARY_RANGE_BYTES}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const text = await res.text();
    const summary = trimSummary(extractMetaDescription(text));
    if (summary) {
      summaryCache.set(url, { value: summary, expiresAt: now + SUMMARY_CACHE_TTL_MS });
    }
    return summary;
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

export const gdeltAdapter: NewsAdapter = async ({ q } = {}) => {
  const query = q && q.trim() ? q.trim() : "United States";
  const params = new URLSearchParams({
    query,
    format: "json",
    maxrecords: "90",
    mode: "ArtList",
    sort: "DateDesc",
  });

  const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`);
  let json: GdeltResponse = {};
  try {
    const text = await res.text();
    json = JSON.parse(text) as GdeltResponse;
  } catch {
    json = {};
  }

  const rawArticles = json.articles ?? [];
  const articles = US_ONLY
    ? rawArticles.filter((article) => isUsArticle(article) && isEnglishArticle(article))
    : rawArticles;
  const titleCounts = new Map<string, number>();
  articles.forEach((article) => {
    const key = normalizeTitle(article.title ?? "");
    if (!key) return;
    titleCounts.set(key, (titleCounts.get(key) ?? 0) + 1);
  });

  const stories = articles.map((a, idx) => ({
    id: a.url ? `gdelt:${a.url}` : `gdelt:${idx}`,
    source: a.sourcecommonname || a.domain || "GDELT",
    kicker: "News",
    title: a.title ?? "Untitled",
    summary: "",
    url: a.url ?? "",
    imageUrl: a.socialimage ?? "",
    imageFloat: "right" as const,
    publishDate: a.seendate ?? "",
    popularity: computePopularity(a, titleCounts),
  }));

  const uniqueStories = dedupeStories(stories);

  const enrichable = uniqueStories
    .filter((story) => story.url)
    .slice()
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, SUMMARY_ENRICH_LIMIT);

  await Promise.allSettled(
    enrichable.map(async (story) => {
      const summary = await fetchSummary(story.url);
      if (summary) story.summary = summary;
    })
  );

  const section: Section = { label: "News", stories: uniqueStories };
  const edition: Edition = { sections: [section] };
  return edition;
};
