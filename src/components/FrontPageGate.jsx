import React, { useEffect, useMemo, useRef, useState } from "react";
import FrontPage from "./FrontPage.jsx";
import { CATEGORIES, DEFAULT_CATEGORY_IDS } from "../data/categories";
import { normalizeText } from "../lib/news/normalize";

const LS_KEY = "hn_selected_categories";
const EVT = "hn-sections-change";
const LOAD_TIMEOUT_MS = 60_000;
const SSR_FRESH_MS = 90_000;
const CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id));
const FRONT_CACHE_PREFIX = "hn_frontpage_cache_v1:";
const FRONT_CACHE_TTL_MS = 2 * 60 * 1000;
const FRONT_RESET_KEY = "hn_frontpage_cache_reset";

function getFrontCacheKey(ids = []) {
  return `${FRONT_CACHE_PREFIX}${ids.join("|")}`;
}

function readFrontCache(ids = []) {
  if (typeof window === "undefined") return null;
  if (!ids.length) return null;
  const key = getFrontCacheKey(ids);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || !Array.isArray(parsed.sections)) return null;
    const resetAt = Number(localStorage.getItem(FRONT_RESET_KEY) || "0");
    const savedAt = Number(parsed.savedAt || 0);
    if (resetAt && resetAt > savedAt) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > FRONT_CACHE_TTL_MS) return null;
    return {
      sections: parsed.sections,
      version: Number(parsed.version || 0),
      savedAt,
    };
  } catch {
    return null;
  }
}

function writeFrontCache(ids = [], sections = [], version = 0) {
  if (typeof window === "undefined") return;
  if (!ids.length || !sections.length) return;
  const key = getFrontCacheKey(ids);
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        version: Number(version) || 0,
        sections,
      })
    );
  } catch {}
}

function debugVersionsEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.__HN_DEBUG_VERSION === true ||
      localStorage.getItem("hn_debug_versions") === "1"
    );
  } catch {
    return false;
  }
}

/* -----------------------------
   Helpers
------------------------------ */

function loadSelected() {
  if (typeof window === "undefined") return DEFAULT_CATEGORY_IDS.slice(0, 3);
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    const cleaned = Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    const unique = Array.from(new Set(cleaned)).filter((id) => CATEGORY_IDS.has(id));
    if (unique.length > 0) return unique.slice(0, 3);
  } catch {
    // fall through to defaults
  }
  const fallback = DEFAULT_CATEGORY_IDS.slice(0, 3);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(fallback));
  } catch {}
  return fallback;
}

function idToLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

function normalizeKey(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function findBestSectionMatch(sections, desiredLabel) {
  const want = normalizeKey(desiredLabel);

  let match = sections.find((s) => normalizeKey(s.label) === want);
  if (match) return match;

  match = sections.find(
    (s) =>
      normalizeKey(s.label).includes(want) ||
      want.includes(normalizeKey(s.label))
  );

  return match ?? null;
}

function findCategoryByLabel(label) {
  const key = normalizeKey(label);
  return CATEGORIES.find((category) => normalizeKey(category.label) === key) ?? null;
}

function getDomainFromUrl(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchesDomain(domain, domains = []) {
  if (!domain) return false;
  return domains.some(
    (entry) => domain === entry || domain.endsWith(`.${entry}`)
  );
}

function scoreStoryForCategory(story, category) {
  const keywords = category?.keywords ?? [];
  const domains = category?.domainsPreferred ?? category?.domains ?? [];
  let score = 0;
  const domain = getDomainFromUrl(story?.url ?? "");
  if (domains.length && matchesDomain(domain, domains)) score += 3;
  if (keywords.length === 0) return score;
  const hay = normalizeText(
    `${story?.title ?? ""} ${story?.summary ?? ""} ${story?.source ?? ""} ${story?.url ?? ""}`
  ).replace(/[^a-z0-9]+/g, " ");
  const words = new Set(hay.split(" ").filter(Boolean));
  keywords.forEach((keyword) => {
    const needle = normalizeText(keyword).replace(/[^a-z0-9]+/g, " ").trim();
    if (!needle) return;
    if (needle.includes(" ")) {
      if (hay.includes(needle)) score += 1;
      return;
    }
    if (words.has(needle)) score += 1;
  });
  return score;
}

function assignStoriesToCategories(stories, labels) {
  const buckets = new Map(labels.map((label) => [label, []]));
  (stories ?? []).forEach((story) => {
    let bestLabel = null;
    let bestScore = 0;
    labels.forEach((label) => {
      const category = findCategoryByLabel(label);
      const score = scoreStoryForCategory(story, category);
      const minScore = category?.minScore ?? 1;
      if (score >= minScore && score > bestScore) {
        bestScore = score;
        bestLabel = label;
      }
    });
    if (bestLabel) {
      buckets.get(bestLabel)?.push(story);
    }
  });
  return buckets;
}

function makePlaceholderSection(label, placeholderState, onRetry) {
  const state = placeholderState ?? "missing";
  const title =
    state === "error"
      ? "Connection error"
      : state === "loading"
        ? "Loading..."
        : "Could not find any headlines...";
  const summary =
    state === "error"
      ? "Try again or contact site administrator at support@happeningnow.news."
      : state === "missing"
        ? "This category isn't mapped yet. When we wire more sources, real headlines will appear here."
        : "";
  return {
    label,
    stories: [
      {
        id: `placeholder-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        isPlaceholder: true,
        placeholderState: state,
        onRetry: state === "error" ? onRetry : undefined,
        kicker: label,
        title,
        summary,
        imageUrl: "",
        imageFloat: "left",
        pageRef: "",
        featured: false,
      },
    ],
  };
}

function isSameSelection(a = [], b = []) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/* -----------------------------
   TEMP: Mock popularity logic
   (Option A)
------------------------------ */

const FEATURED_COUNT = 3;
const BREAKING_MIN_PCT = 90;
const BREAKING_WINDOW_HOURS = 3;
const FEATURED_WINDOW_HOURS = 24;

// Stable hash → number (same story = same popularity every load)
function hashScore(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % 1000; // 0–999
}

function getPopularity(story) {
  // If real popularity exists, prefer it
  const real = Number(
    story?.popularity ??
      story?.score ??
      story?.rank ??
      story?.views
  );
  if (Number.isFinite(real) && real > 0) return real;

  // TEMP fallback: deterministic popularity
  return hashScore(`${story?.id ?? ""}|${story?.title ?? ""}`);
}

function getDateMs(story) {
  const d = story?.publishDate ?? story?.date ?? null;
  const ms = d ? new Date(d).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function getPopularityPct(popularity, maxPopularity) {
  if (!Number.isFinite(maxPopularity) || maxPopularity <= 0) return 0;
  return (popularity / maxPopularity) * 100;
}

function getAgeHours(publishMs, nowMs) {
  if (!Number.isFinite(publishMs) || publishMs <= 0) return Number.POSITIVE_INFINITY;
  return (nowMs - publishMs) / (1000 * 60 * 60);
}

function normalizeTitleKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getStoryDayKey(value = "") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function byPopularityThenDate(a, b) {
  const ap = getPopularity(a);
  const bp = getPopularity(b);
  if (bp !== ap) return bp - ap;

  return getDateMs(b) - getDateMs(a);
}

function isNewsApiStory(story) {
  return String(story?.id ?? "").startsWith("newsapi:");
}

function buildEditionFromThreeSections(exactThreeSections, maxStories = 30) {
  const nowMs = Date.now();
  const seenTitles = new Set();
  const allStories = exactThreeSections.flatMap((sec) =>
    (sec.stories ?? []).map((story) => ({
      ...story,
      kicker: sec.label,
      popularity: getPopularity(story),
    }))
  ).filter((story) => {
    if (story?.isPlaceholder) return true;
    const titleKey = normalizeTitleKey(story.title ?? "");
    if (!titleKey) return true;
    const dayKey = getStoryDayKey(story.publishDate ?? "");
    const key = dayKey ? `${titleKey}:${dayKey}` : titleKey;
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  const maxPopularity = allStories.reduce(
    (max, story) => Math.max(max, story.popularity || 0),
    0
  );

  const scored = allStories.map((story) => {
    const popularityPct = getPopularityPct(story.popularity || 0, maxPopularity);
    const ageHours = getAgeHours(getDateMs(story), nowMs);
    const breaking =
      !!story.breaking ||
      (popularityPct >= BREAKING_MIN_PCT && ageHours <= BREAKING_WINDOW_HOURS);
    return { ...story, breaking };
  });

  const preferredFeaturedPool = scored.filter((story) => isNewsApiStory(story));
  const featuredPool = preferredFeaturedPool.length ? preferredFeaturedPool : scored;

  const featuredIds = featuredPool
    .slice()
    .sort(byPopularityThenDate)
    .filter((story) => {
      const ageHours = getAgeHours(getDateMs(story), nowMs);
      return (story.popularity || 0) > 0 && ageHours <= FEATURED_WINDOW_HOURS;
    })
    .slice(0, FEATURED_COUNT)
    .map((story) => story.id);

  const withFlags = scored.map((story) => ({
    ...story,
    featured: story.featured || featuredIds.includes(story.id),
  }));

  const ranked = withFlags.slice().sort(byPopularityThenDate);
  const featuredRow = ranked
    .filter((story) => featuredIds.includes(story.id))
    .slice(0, FEATURED_COUNT);
  const usedIds = new Set(featuredRow.map((story) => story.id));

  const merged = [
    ...featuredRow,
    ...ranked.filter((story) => !usedIds.has(story.id)),
  ].slice(0, maxStories);

  return [
    {
      label: "Front Page",
      stories: merged,
    },
  ];
}

/* -----------------------------
   Component
------------------------------ */

export default function FrontPageGate({ data }) {
  const baseSections = data?.sections ?? [];
  const [liveSections, setLiveSections] = useState(null);
  const [liveKey, setLiveKey] = useState("");
  const [liveVersion, setLiveVersion] = useState(0);
  const liveVersionRef = useRef(0);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedIds, setSelectedIds] = useState(() =>
    DEFAULT_CATEGORY_IDS.slice(0, 3)
  );
  const [hasHydrated, setHasHydrated] = useState(false);
  const selectedKey = selectedIds.join("|");
  const useBaseSections = isSameSelection(
    selectedIds,
    DEFAULT_CATEGORY_IDS.slice(0, 3)
  );
  const sections =
    liveSections && liveKey === selectedKey
      ? liveSections
      : useBaseSections
        ? baseSections
        : [];

  useEffect(() => {
    if (!hasHydrated) return;
    if (typeof window === "undefined") return;
    const cached = readFrontCache(selectedIds);
    if (cached?.sections?.length) {
      setLiveSections(cached.sections);
      setLiveKey(selectedKey);
      setLiveVersion(cached.version || 0);
      return;
    }
    setLiveSections(null);
    setLiveKey("");
    setLiveVersion(0);
  }, [selectedIds, hasHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!liveSections || !liveSections.length) return;
    if (liveKey !== selectedKey) return;
    writeFrontCache(selectedIds, liveSections, liveVersion);
  }, [liveSections, liveKey, selectedIds, selectedKey, liveVersion]);

  useEffect(() => {
    liveVersionRef.current = liveVersion;
  }, [liveVersion]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = loadSelected().slice(0, 3);
    setSelectedIds(next);
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (typeof window === "undefined") return;
    const serverFetchedAt = Number(data?.meta?.fetchedAt || 0);
    if (
      useBaseSections &&
      baseSections.length &&
      serverFetchedAt &&
      Date.now() - serverFetchedAt < SSR_FRESH_MS
    ) {
      if (debugVersionsEnabled()) {
        console.info("[frontpage] skip refetch (fresh SSR)", {
          selectedKey,
          serverFetchedAt,
        });
      }
      return;
    }

    let active = true;
    const controller = new AbortController();
    setTimedOut(false);

    const categoryParam = selectedIds.length
      ? `?categories=${encodeURIComponent(selectedIds.join(","))}`
      : "";
    const timeoutId = window.setTimeout(() => {
      if (!active) return;
      setTimedOut(true);
      controller.abort();
    }, LOAD_TIMEOUT_MS);

    (async () => {
      let fetched = false;
      try {
        console.info("[frontpage] fetch start", { selectedKey, categoryParam });
        const res = await fetch(`/api/news.json${categoryParam}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        fetched = true;
        if (!active) return;
        const nextSections = json.sections ?? [];
        console.info("[frontpage] fetch response", {
          selectedKey,
          sections: nextSections.length,
          stories: nextSections.reduce(
            (sum, section) => sum + (section.stories?.length || 0),
            0
          ),
        });
        if (!nextSections.length) {
          setTimedOut(true);
          return;
        }
        window.clearTimeout(timeoutId);
        const nextVersion = Number(json?.meta?.fetchedAt || 0);
        const currentVersion = liveVersionRef.current;
        if (
          currentVersion &&
          nextVersion &&
          nextVersion <= currentVersion &&
          liveKey === selectedKey
        ) {
          if (debugVersionsEnabled()) {
            console.info("[frontpage] skip update", {
              selectedKey,
              currentVersion,
              nextVersion,
            });
          }
          setTimedOut(false);
          return;
        }
        if (debugVersionsEnabled()) {
          console.info("[frontpage] apply update", {
            selectedKey,
            currentVersion,
            nextVersion,
            stories: nextSections.reduce(
              (sum, section) => sum + (section.stories?.length || 0),
              0
            ),
          });
        }
        setLiveSections(nextSections);
        setLiveKey(selectedKey);
        setLiveVersion(nextVersion || Date.now());
        setTimedOut(false);
      } catch (err) {
        if (!active) return;
        console.warn("[frontpage] fetch error", {
          selectedKey,
          message: err instanceof Error ? err.message : String(err),
        });
        setTimedOut(true);
      } finally {
        if (!active) return;
        if (!fetched) {
          console.info("[frontpage] fetch end", { selectedKey, ok: false });
        } else {
          console.info("[frontpage] fetch end", { selectedKey, ok: true });
        }
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    reloadToken,
    selectedIds,
    hasHydrated,
    useBaseSections,
    baseSections.length,
    data?.meta?.fetchedAt,
  ]);

  const placeholderState =
    sections.length === 0 ? (timedOut ? "error" : "loading") : null;
  const handleRetry = () => setReloadToken((prev) => prev + 1);

  useEffect(() => {
    if (!hasHydrated) return;
    const sync = () => setSelectedIds(loadSelected().slice(0, 3));
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [hasHydrated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageShow = (event) => {
      if (!event.persisted) return;
      const restored = loadSelected().slice(0, 3);
      setHasHydrated(true);
      setSelectedIds(restored);
      setReloadToken((prev) => prev + 1);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const selectedLabels = useMemo(
    () => selectedIds.map(idToLabel),
    [selectedIds]
  );

  /* -----------------------------
     Empty state
  ------------------------------ */
  if (selectedIds.length === 0) {
    return (
      <section style={{ marginTop: 18 }}>
        <div style={{ borderTop: "2px solid var(--ink)", paddingTop: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            Choose 3 categories to build your edition.
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: "var(--muted)",
              borderLeft: "2px solid var(--ink)",
              padding: "10px 12px",
            }}
          >
            Pick 3 sections from the strip above.
          </div>
        </div>
      </section>
    );
  }

  /* -----------------------------
     Build EXACT 3 sections
  ------------------------------ */
  const exactThreeSections = useMemo(() => {
    const allStories = sections.flatMap((section) => section.stories ?? []);
    const keywordAssignments = assignStoriesToCategories(allStories, selectedLabels);
    const fallbackAssignments =
      sections.length === 1
        ? assignStoriesToCategories(sections[0]?.stories ?? [], selectedLabels)
        : null;
    const usedIds = new Set();
    const BORROW_LIMIT = 4;

    return selectedLabels.map((label) => {
      const match = findBestSectionMatch(sections, label);
      const fallback = !match && sections.length === 1 ? sections[0] : null;
      if (!match && !fallback) {
        return makePlaceholderSection(label, placeholderState, handleRetry);
      }

      const base = match ?? fallback ?? { label, stories: [] };
      let baseStories = base?.stories ?? [];

      if (!match && fallback) {
        const assigned = fallbackAssignments?.get(label) ?? [];
        if (!assigned.length) {
          return makePlaceholderSection(label, placeholderState, handleRetry);
        }
        baseStories = assigned;
      }

      if (!baseStories.length) {
        const borrowed = keywordAssignments?.get(label) ?? [];
        baseStories = borrowed
          .filter((story) => !usedIds.has(story.id))
          .slice(0, BORROW_LIMIT);
      }

      if (!baseStories.length) {
        baseStories = allStories
          .filter((story) => story?.id && !usedIds.has(story.id))
          .slice(0, BORROW_LIMIT);
      }

      const uniqueStories = baseStories.filter((story) => {
        if (!story?.id) return false;
        if (usedIds.has(story.id)) return false;
        usedIds.add(story.id);
        return true;
      });

      if (!uniqueStories.length) {
        return makePlaceholderSection(label, placeholderState, handleRetry);
      }

      const hydrated = {
        ...base,
        label,
        stories: uniqueStories.map((story) => ({
          ...story,
          kicker: label,
          imageUrl: story.isPlaceholder ? "" : story.imageUrl,
        })),
      };

    return hydrated;
    });
  }, [sections, selectedLabels, placeholderState, handleRetry]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sections.length > 0 || timedOut) {
      window.dispatchEvent(new Event("hn-pagewait-done"));
    }
  }, [sections.length, timedOut]);

  /* -----------------------------
     Build popularity-ordered edition
  ------------------------------ */
  const editionSections = useMemo(() => {
    const minPerSection = 20;
    const maxStories = Math.max(30, exactThreeSections.length * minPerSection);
    return buildEditionFromThreeSections(exactThreeSections, maxStories);
  }, [exactThreeSections]);
  const statusMessage =
    sections.length === 0
      ? timedOut
        ? "No stories found — try different categories"
        : "Rendering latest stories..."
      : "";

  return (
    <FrontPage
      sections={editionSections}
      mode="all"
      selectionOrder={selectedLabels}
      statusMessage={statusMessage}
    />
  );
}
