import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "../data/categories";
import { normalizeText, sanitizeQuery } from "../lib/news/normalize";

function normalize(str = "") {
  return String(str).toLowerCase();
}

function getPageFromUrl() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = Number(params.get(PAGE_PARAM));
  if (!Number.isFinite(raw) || raw < 1) return null;
  return raw - 1;
}

function setPageInUrl(page, mode = "replace") {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (page <= 0) url.searchParams.delete(PAGE_PARAM);
  else url.searchParams.set(PAGE_PARAM, String(page + 1));
  if (mode === "push") window.history.pushState({}, "", url);
  else window.history.replaceState({}, "", url);
}

function getCookie(name) {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name, value, maxAge = 60 * 60 * 24 * 7) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(String(value))}; path=/; max-age=${maxAge}`;
}

function logEvent(name, detail = {}) {
  try {
    console.info("[analytics]", name, detail);
  } catch {}
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getStoryPopularity(story) {
  const raw = Number(
    story?.popularity ??
      story?.score ??
      story?.rank ??
      story?.views
  );
  return Number.isFinite(raw) ? raw : 0;
}

function getStoryDateMs(story) {
  const d = story?.publishDate ?? story?.date ?? null;
  const ms = d ? new Date(d).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function byPopularityThenDate(a, b) {
  const ap = getStoryPopularity(a);
  const bp = getStoryPopularity(b);
  if (bp !== ap) return bp - ap;
  return getStoryDateMs(b) - getStoryDateMs(a);
}

function normalizeKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const CATEGORY_MAP = new Map(
  CATEGORIES.map((category) => [normalizeKey(category.label), category])
);

function findCategoryByLabel(label) {
  return CATEGORY_MAP.get(normalizeKey(label)) ?? null;
}

function getCategoryIconPath(label) {
  const category = findCategoryByLabel(label);
  const id = category?.id ?? "default";
  return `/icons/${id}.svg`;
}

function isNewsApiStory(story) {
  return String(story?.id ?? "").startsWith("newsapi:");
}

function scoreStoryForCategory(story, category) {
  const keywords = category?.keywords ?? [];
  const domains = category?.domainsPreferred ?? category?.domains ?? [];
  let score = 0;
  const domain = (() => {
    try {
      return new URL(story?.url ?? "").hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  })();
  if (domains.length && domain) {
    const match = domains.some(
      (entry) => domain === entry || domain.endsWith(`.${entry}`)
    );
    if (match) score += 3;
  }
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

const BOOKMARK_KEY = "hn_bookmarks";
const BOOKMARK_ITEMS_KEY = "hn_bookmark_items";
const BOOKMARK_EVT = "hn-bookmarks-change";

const SEARCH_KEY = "hn_search_q";
const SEARCH_EVT = "hn-search-change";
const TOP_ROW_KEY = "hn_top_row_kickers";
const PAGE_PARAM = "page";
const SEARCH_CACHE_PREFIX = "hn_search_cache_v1:";
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000;

function getSearchCacheKey(query = "") {
  return `${SEARCH_CACHE_PREFIX}${query}`;
}

function readSearchCache(query = "") {
  if (typeof window === "undefined") return null;
  const key = getSearchCacheKey(query);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || !Array.isArray(parsed.sections)) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > SEARCH_CACHE_TTL_MS) return null;
    return {
      sections: parsed.sections,
      version: Number(parsed.version || 0),
      savedAt: Number(parsed.savedAt || 0),
    };
  } catch {
    return null;
  }
}

function writeSearchCache(query = "", sections = [], version = 0) {
  if (typeof window === "undefined") return;
  const key = getSearchCacheKey(query);
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
   Bookmarks: shared, synced
------------------------------ */

function safeReadBookmarks() {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    const parsed = JSON.parse(raw || "[]");
    const ids = Array.isArray(parsed) ? parsed : [];
    if (ids.length) return ids;
    const fallbackItems = safeReadBookmarkItems();
    return Object.keys(fallbackItems ?? {});
  } catch {
    return [];
  }
}

function safeReadBookmarkItems() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(BOOKMARK_ITEMS_KEY);
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function safeWriteBookmarks(ids) {
  try {
    const unique = Array.from(new Set(ids));
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(unique));
  } catch {}
  window.dispatchEvent(new CustomEvent(BOOKMARK_EVT, { detail: ids }));
}

function safeWriteBookmarkItems(items) {
  try {
    localStorage.setItem(BOOKMARK_ITEMS_KEY, JSON.stringify(items));
  } catch {}
  window.dispatchEvent(new CustomEvent(BOOKMARK_EVT));
}

function normalizeBookmarkStory(story) {
  if (!story || !story.id) return null;
  return {
    id: story.id,
    source: story.source ?? "",
    kicker: story.kicker ?? "",
    title: story.title ?? "",
    summary: story.summary ?? "",
    url: story.url ?? "",
    imageUrl: story.imageUrl ?? "",
    imageFloat: story.imageFloat ?? "right",
    publishDate: story.publishDate ?? "",
    pageRef: story.pageRef ?? "",
    featured: !!story.featured,
    breaking: !!story.breaking,
    popularity: Number(story.popularity) || 0,
    savedAt: Date.now(),
  };
}

function useBookmarks() {
  const [ids, setIds] = useState(() => []);

  useEffect(() => {
    setIds(safeReadBookmarks());

    const sync = () => setIds(safeReadBookmarks());

    const onEvt = (e) => {
      const next = e?.detail;
      if (Array.isArray(next)) setIds(next);
      else sync();
    };

    window.addEventListener(BOOKMARK_EVT, onEvt);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BOOKMARK_EVT, onEvt);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const has = (id) => ids.includes(id);

  const toggle = (id, story) => {
    const currentIds = safeReadBookmarks();
    const exists = currentIds.includes(id);
    const next = exists
      ? currentIds.filter((x) => x !== id)
      : [...currentIds, id];
    setIds(next);
    safeWriteBookmarks(next);
    const current = safeReadBookmarkItems();
    if (exists) {
      if (current[id]) {
        const updated = { ...current };
        delete updated[id];
        safeWriteBookmarkItems(updated);
      }
    } else {
      const normalized = normalizeBookmarkStory(story);
      if (normalized) {
        const updated = { ...current, [normalized.id]: normalized };
        safeWriteBookmarkItems(updated);
      }
    }
  };

  return { ids, has, toggle };
}

function useBookmarkItems() {
  const [items, setItems] = useState(() => ({}));

  useEffect(() => {
    setItems(safeReadBookmarkItems());

    const sync = () => setItems(safeReadBookmarkItems());
    window.addEventListener(BOOKMARK_EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BOOKMARK_EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const upsert = (story) => {
    const normalized = normalizeBookmarkStory(story);
    if (!normalized) return;
    const current = safeReadBookmarkItems();
    const next = { ...current, [normalized.id]: normalized };
    safeWriteBookmarkItems(next);
  };

  const remove = (id) => {
    const current = safeReadBookmarkItems();
    if (!current[id]) return;
    const next = { ...current };
    delete next[id];
    safeWriteBookmarkItems(next);
  };

  return { items, upsert, remove };
}

/* -----------------------------
   Flatten sections
------------------------------ */

function flatten(sections = []) {
  return (sections ?? []).flatMap((section) =>
    (section.stories ?? []).map((story) => ({
      ...story,
      kicker: story.kicker ?? section.label ?? "",
    }))
  );
}

/**
 * Props:
 * - sections: array of { label, stories[] }
 * - mode: "all" | "bookmarks"
 */
export default function FrontPage(props) {
  const baseSections = props.sections ?? [];
  const mode = props.mode ?? "all";
  const selectionOrder = props.selectionOrder ?? [];
  const statusMessage = props.statusMessage ?? "";

  /* -----------------------------
     Search query (event-driven)
  ------------------------------ */

  const [q, setQ] = useState("");

  useEffect(() => {
    function sync(e) {
      try {
        const next =
          typeof e?.detail === "string"
            ? e.detail
            : localStorage.getItem(SEARCH_KEY) || "";
        setQ(next);
      } catch {}
    }
    sync();
    window.addEventListener(SEARCH_EVT, sync);
    return () => window.removeEventListener(SEARCH_EVT, sync);
  }, []);

  /* -----------------------------
     API search
  ------------------------------ */

  const [apiSections, setApiSections] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [page, setPage] = useState(0);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [breakingFlashIds, setBreakingFlashIds] = useState(() => []);
  const pageNavMode = useRef("replace");
  const didMount = useRef(false);
  const popstateActive = useRef(false);
  const PAGE_SIZE = 6;
  const PAGE_SIZE_FIRST = 8;
  const MIN_MORE_STORIES = 8;
  const lastFetchRef = useRef(0);
  const pendingFetchRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef(null);
  const searchVersionRef = useRef({ query: "", version: 0 });

  const bookmarks = useBookmarks();
  const bookmarkedIds = bookmarks.ids;
  const { items: bookmarkItems } = useBookmarkItems();

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!bookmarkedIds.length) return;
    const current = safeReadBookmarkItems();
    const allowed = new Set(bookmarkedIds);
    const next = {};
    let changed = false;
    Object.entries(current ?? {}).forEach(([id, story]) => {
      if (allowed.has(id)) {
        next[id] = story;
      } else {
        changed = true;
      }
    });
    if (changed) {
      safeWriteBookmarkItems(next);
    }
  }, [bookmarkedIds, hasHydrated]);

  useEffect(() => {
    if (bookmarkedIds.length > 0) return;
    if (!Object.keys(bookmarkItems ?? {}).length) return;
    try {
      localStorage.setItem("hn_bookmark_items", JSON.stringify({}));
      window.dispatchEvent(new CustomEvent("hn-bookmarks-change"));
    } catch {}
  }, [bookmarkedIds, bookmarkItems]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      popstateActive.current = true;
      const fromUrl = getPageFromUrl();
      setPage(fromUrl !== null ? fromUrl : 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const { query: sanitized, valid } = sanitizeQuery(q);
    const query = normalize(sanitized).trim();

    if (!query || !valid) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setApiSections(null);
      setLoading(false);
      setErr("");
      return;
    }

    const cached = readSearchCache(query);
    const hasCached = !!cached?.sections?.length;
    if (hasCached) {
      searchVersionRef.current = {
        query,
        version: Number(cached.version || 0),
      };
      setApiSections(cached.sections ?? []);
      setLoading(false);
      setErr("");
      if (debugVersionsEnabled()) {
        console.info("[search] cache hit", {
          query,
          version: Number(cached.version || 0),
          stories: cached.sections.reduce(
            (sum, section) => sum + (section.stories?.length || 0),
            0
          ),
        });
      }
    } else if (searchVersionRef.current.query !== query) {
      searchVersionRef.current = { query, version: 0 };
      if (debugVersionsEnabled()) {
        console.info("[search] cache miss", { query });
      }
    }

    const run = async () => {
      if (!hasCached) setLoading(true);
      setErr("");
      const reqId = ++requestIdRef.current;

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/news/${encodeURIComponent(query)}.json`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (reqId !== requestIdRef.current) return;
        const nextSections = json.sections ?? [];
        const nextVersion = Number(json?.meta?.fetchedAt || 0);
        const current = searchVersionRef.current;
        if (
          current.query === query &&
          current.version &&
          nextVersion &&
          nextVersion <= current.version
        ) {
          if (debugVersionsEnabled()) {
            console.info("[search] skip update", {
              query,
              currentVersion: current.version,
              nextVersion,
            });
          }
          return;
        }
        searchVersionRef.current = { query, version: nextVersion || 0 };
        setApiSections(nextSections);
        writeSearchCache(query, nextSections, nextVersion);
        if (debugVersionsEnabled()) {
          console.info("[search] apply update", {
            query,
            nextVersion,
            stories: nextSections.reduce(
              (sum, section) => sum + (section.stories?.length || 0),
              0
            ),
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (reqId !== requestIdRef.current) return;
        setApiSections([]);
        setErr("Search failed (API).");
      } finally {
        if (reqId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    const now = Date.now();
    const elapsed = now - lastFetchRef.current;
    const wait = Math.max(0, 400 - elapsed);

    if (pendingFetchRef.current) {
      window.clearTimeout(pendingFetchRef.current);
    }

    pendingFetchRef.current = window.setTimeout(async () => {
      lastFetchRef.current = Date.now();
      await run();
    }, wait);

    return () => {
      if (pendingFetchRef.current) {
        window.clearTimeout(pendingFetchRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [q]);

  /* -----------------------------
     Story selection
  ------------------------------ */

  const categorizedApiSections = useMemo(() => {
    if (!apiSections) return null;
    if (!selectionOrder.length) return apiSections;
    const apiStories = flatten(apiSections);
    const assignments = assignStoriesToCategories(apiStories, selectionOrder);
    return selectionOrder.map((label) => ({
      label,
      stories: assignments.get(label) ?? [],
    }));
  }, [apiSections, selectionOrder]);

  const bookmarkStories = useMemo(() => {
    const values = Object.values(bookmarkItems ?? {});
    const allowed = new Set(bookmarkedIds);
    return values
      .filter((story) => story && story.id && allowed.has(story.id))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }, [bookmarkItems, bookmarkedIds]);

  const bookmarkSections = useMemo(() => {
    if (!bookmarkStories.length) return null;
    return [
      {
        label: "Bookmarks",
        stories: bookmarkStories,
      },
    ];
  }, [bookmarkStories]);

  const sectionsToUse =
    mode === "bookmarks"
      ? bookmarkSections ?? []
      : categorizedApiSections ?? baseSections;

  const bookmarkSyncNeeded =
    mode === "bookmarks" && bookmarkedIds.length > 0 && bookmarkStories.length === 0;

  const allStories = useMemo(
    () => flatten(sectionsToUse),
    [sectionsToUse]
  );

  const visibleStories = useMemo(() => {
    if (mode !== "bookmarks") return allStories;
    return allStories.filter((s) => bookmarkedIds.includes(s.id));
  }, [mode, allStories, bookmarkedIds]);

  const workingStories = useMemo(() => {
    if (mode !== "bookmarks" && showBookmarksOnly) {
      return allStories.filter((s) => bookmarkedIds.includes(s.id));
    }
    return visibleStories;
  }, [mode, showBookmarksOnly, allStories, bookmarkedIds, visibleStories]);

  const displayedStories = useMemo(
    () => workingStories.filter((s) => !removingIds.has(s.id)),
    [workingStories, removingIds]
  );

  const handleBookmarkToggle = useCallback((story, saved, doToggle) => {
    if (!story?.id) return;
    if (mode === "bookmarks" || showBookmarksOnly) {
      setRemovingIds((prev) => new Set(prev).add(story.id));
      setTimeout(() => {
        doToggle();
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(story.id);
          return next;
        });
      }, 200);
    } else {
      doToggle();
    }
  }, [mode, showBookmarksOnly]);

  /* -----------------------------
     🔑 Emit live story count
  ------------------------------ */

  useEffect(() => {
    try {
      const n = visibleStories.length;
      localStorage.setItem("hn_story_count", String(n));
      window.dispatchEvent(new Event("hn-story-count"));
    } catch {}
  }, [visibleStories]);

  useEffect(() => {
    if (mode !== "bookmarks") return;
    if (bookmarkedIds.length > 0 || bookmarkStories.length > 0) return;
  }, [mode, bookmarkedIds, bookmarkStories]);

  /* -----------------------------
     Layout logic
  ------------------------------ */

  const effectiveOrder = useMemo(() => {
    if (mode === "bookmarks" || showBookmarksOnly) {
      return Array.from(new Set(displayedStories.map((s) => s.kicker)));
    }
    return selectionOrder;
  }, [mode, showBookmarksOnly, displayedStories, selectionOrder]);

  const pickTopForLabel = (label, usedIds) => {
    const pool = displayedStories.filter(
      (s) => s.kicker === label && !usedIds.has(s.id)
    );
    if (!pool.length) return null;
    const preferred = pool.filter(isNewsApiStory);
    const workingPool = preferred.length ? preferred : pool;
    const breaking = workingPool.find((s) => s.breaking);
    if (breaking) return breaking;
    const featuredStory = workingPool.find((s) => s.featured);
    if (featuredStory) return featuredStory;
    return workingPool.slice().sort(byPopularityThenDate)[0] ?? null;
  };

  const topStories = useMemo(() => {
    if (displayedStories.length === 0) return [];

    const usedIds = new Set();
    const ordered = [];

    const uniqueOrder = effectiveOrder.filter(
      (label, idx, arr) => label && arr.indexOf(label) === idx
    );

    for (const label of uniqueOrder) {
      if (ordered.length >= 3) break;
      const pick = pickTopForLabel(label, usedIds);
      if (pick) {
        ordered.push(pick);
        usedIds.add(pick.id);
      }
    }

    // If we still have fewer than 3, fill with remaining unique kickers
    if (ordered.length < 3) {
      const sortedByPop = displayedStories.slice().sort(byPopularityThenDate);
      const usedKickers = new Set(ordered.map((s) => s.kicker));
      for (const story of sortedByPop) {
        if (ordered.length >= 3) break;
        if (usedIds.has(story.id)) continue;
        if (usedKickers.has(story.kicker)) continue;
        ordered.push(story);
        usedIds.add(story.id);
        usedKickers.add(story.kicker);
      }
    }

    // If still short, allow duplicates only to fill remaining slots
    if (ordered.length < 3) {
      const sortedByPop = displayedStories.slice().sort(byPopularityThenDate);
      for (const story of sortedByPop) {
        if (ordered.length >= 3) break;
        if (usedIds.has(story.id)) continue;
        ordered.push(story);
        usedIds.add(story.id);
      }
    }

    return ordered.slice(0, 3);
  }, [effectiveOrder, displayedStories]);

  useEffect(() => {
    const newBreakingIds = topStories
      .filter((story) => story?.breaking)
      .map((story) => story?.id)
      .filter(Boolean)
      .filter((id) => !breakingFlashIds.includes(id));
    if (!newBreakingIds.length) return;
    setBreakingFlashIds((prev) => [...prev, ...newBreakingIds]);
    const timer = window.setTimeout(() => {
      setBreakingFlashIds((prev) => prev.filter((id) => !newBreakingIds.includes(id)));
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [topStories, breakingFlashIds]);

  const topColCount = Math.max(1, Math.min(3, topStories.length || 3));
  const pageSize = page === 0 ? PAGE_SIZE_FIRST : PAGE_SIZE;
  const skeletonCols = useMemo(() => {
    const cols = Array.from({ length: topColCount }, () => []);
    for (let i = 0; i < pageSize; i++) {
      cols[i % topColCount].push(i);
    }
    return cols;
  }, [topColCount, pageSize]);

  useEffect(() => {
    try {
      const kickers = topStories.map((s) => s?.kicker).filter(Boolean);
      const uniqueKickers = Array.from(new Set(kickers));
      localStorage.setItem(TOP_ROW_KEY, JSON.stringify(uniqueKickers));
      window.dispatchEvent(
        new CustomEvent("hn-top-row-change", { detail: uniqueKickers })
      );
    } catch {}
  }, [topStories]);

  const featured = useMemo(() => {
    return topStories[1] ?? topStories[0] ?? null;
  }, [topStories]);

  const primarySides = useMemo(() => {
    const sides = featured
      ? topStories.filter((s) => s.id !== featured.id)
      : topStories;
    return [sides[0] ?? null, sides[1] ?? null];
  }, [topStories, featured]);

  const usedTopIds = useMemo(() => {
    const ids = new Set(topStories.map((s) => s?.id).filter(Boolean));
    if (featured?.id) ids.add(featured.id);
    return ids;
  }, [featured, topStories]);

  const morePool = useMemo(
    () => displayedStories.filter((s) => !usedTopIds.has(s.id)),
    [displayedStories, usedTopIds]
  );

  const moreSourcePool = useMemo(() => {
    if (mode === "bookmarks") return morePool;
    const gdeltOnly = morePool.filter(
      (story) => String(story?.id ?? "").startsWith("gdelt:")
    );
    return gdeltOnly.length ? gdeltOnly : morePool;
  }, [mode, morePool]);

  const maxPopularity = useMemo(
    () =>
      moreSourcePool.reduce((max, s) => {
        const pop = Number(s.popularity) || 0;
        return pop > max ? pop : max;
      }, 0),
    [moreSourcePool]
  );

  const popularityCutoff = maxPopularity * 0.5;

  const moreStories = useMemo(() => {
    const base = moreSourcePool.filter(
      (s) => (Number(s.popularity) || 0) < popularityCutoff
    );
    const filtered = showBookmarksOnly
      ? base.filter((s) => bookmarkedIds.includes(s.id))
      : base;
    const ids = new Set(filtered.map((s) => s.id));
    let result = filtered.slice();

    if (result.length < MIN_MORE_STORIES) {
      const candidates = (showBookmarksOnly
        ? morePool.filter((s) => bookmarkedIds.includes(s.id))
        : morePool
      )
        .filter((s) => !ids.has(s.id))
        .slice()
        .sort((a, b) => getStoryPopularity(a) - getStoryPopularity(b));
      for (const story of candidates) {
        if (result.length >= MIN_MORE_STORIES) break;
        result.push(story);
        ids.add(story.id);
      }
    }

    if (result.length) return result;
    return showBookmarksOnly
      ? morePool.filter((s) => bookmarkedIds.includes(s.id))
      : morePool;
  }, [morePool, popularityCutoff, showBookmarksOnly, bookmarkedIds]);

  useEffect(() => {
    const fromUrl = getPageFromUrl();
    const fromCookie = Number(getCookie(`hn_page_${mode}`));
    setPage(
      fromUrl !== null
        ? fromUrl
        : Number.isFinite(fromCookie) && fromCookie >= 0
          ? fromCookie
          : 0
    );

    const showCookie = getCookie(`hn_bookmarksOnly_${mode}`);
    if (mode === "all") {
      setShowBookmarksOnly(false);
      setCookie(`hn_bookmarksOnly_${mode}`, "0");
    } else {
      setShowBookmarksOnly(showCookie === "1");
    }
  }, [mode]);

  useEffect(() => {
    if (!showBookmarksOnly) return;
    if (bookmarkedIds.length > 0) return;
    setShowBookmarksOnly(false);
    setCookie(`hn_bookmarksOnly_${mode}`, "0");
  }, [showBookmarksOnly, bookmarkedIds, mode]);

  const maxPage = Math.max(
    0,
    moreStories.length <= PAGE_SIZE_FIRST
      ? 0
      : Math.ceil((moreStories.length - PAGE_SIZE_FIRST) / PAGE_SIZE)
  );
  useEffect(() => {
    setPage((p) => Math.min(p, maxPage));
  }, [maxPage]);

  useEffect(() => {
    setCookie(`hn_page_${mode}`, page);
    if (popstateActive.current) {
      setPageInUrl(page, "replace");
      popstateActive.current = false;
    } else {
      setPageInUrl(page, pageNavMode.current);
      pageNavMode.current = "replace";
    }
  }, [page, mode]);

  useEffect(() => {
    setCookie(`hn_bookmarksOnly_${mode}`, showBookmarksOnly ? "1" : "0");
  }, [showBookmarksOnly, mode]);

  const pagedStories = useMemo(() => {
    const start =
      page === 0 ? 0 : PAGE_SIZE_FIRST + (page - 1) * PAGE_SIZE;
    return moreStories.slice(start, start + pageSize);
  }, [moreStories, page, pageSize]);

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setIsPageLoading(true);
    const t = window.setTimeout(() => setIsPageLoading(false), 220);
    return () => window.clearTimeout(t);
  }, [page]);

  const moreColumns = useMemo(() => {
    const cols = [[], [], []];
    const topKickers = topStories.map((s) => s?.kicker);
    const maxPerCol = Math.max(1, Math.ceil(pagedStories.length / topColCount));

    pagedStories.forEach((story) => {
      const idx = topKickers.indexOf(story.kicker);
      const targetIdx =
        idx !== -1 && cols[idx].length < maxPerCol
          ? idx
          : cols
              .map((c, i) => ({ i, len: c.length }))
              .sort((a, b) => a.len - b.len)[0].i;
      cols[targetIdx].push(story);
    });

    return cols;
  }, [pagedStories, topStories, topColCount]);

  /* -----------------------------
     Render
  ------------------------------ */

  return (
    <section>
      {err ? <div className="error">{err}</div> : null}
      {bookmarkSyncNeeded ? (
        <div className="syncNote">
          Syncing your bookmarks. If nothing appears, refresh or re-save a story.
        </div>
      ) : null}
      {hasHydrated && (statusMessage || loading) ? (
        <div className="loading">
          {statusMessage || "Rendering latest stories..."}
        </div>
      ) : null}

      <div className="frontpage">
        <div className="col">
          {primarySides[0] ? (
            <Story
              story={{ ...primarySides[0], featured: true }}
              bookmarks={bookmarks}
              handleBookmarkToggle={handleBookmarkToggle}
              isRemoving={removingIds.has(primarySides[0].id)}
              forceFeatured
              breakingFlash={breakingFlashIds.includes(primarySides[0]?.id)}
            />
          ) : null}
        </div>

        <div className="col feature">
          {featured ? (
            <Story
              story={{ ...featured, featured: true }}
              bookmarks={bookmarks}
              handleBookmarkToggle={handleBookmarkToggle}
              isRemoving={removingIds.has(featured.id)}
              forceFeatured
              breakingFlash={breakingFlashIds.includes(featured.id)}
            />
          ) : (
            <div className="empty">
              {mode === "bookmarks"
                ? "No bookmarks yet. Go back to the front page and star a story."
                : "No matches."}
            </div>
          )}
        </div>

        <div className="col">
          {primarySides[1] ? (
            <Story
              story={{ ...primarySides[1], featured: true }}
              bookmarks={bookmarks}
              handleBookmarkToggle={handleBookmarkToggle}
              isRemoving={removingIds.has(primarySides[1].id)}
              forceFeatured
              breakingFlash={breakingFlashIds.includes(primarySides[1]?.id)}
            />
          ) : null}
        </div>
      </div>

      {moreStories.length > 0 ? (
        <section className="moreSection" aria-label="More stories by popularity">
          <div className="moreHeader">
            <div className="moreTitle">
              More stories
              <span className="sourceTag">Source: GDELT / NEWSAPI.AI</span>
            </div>
            <div className="moreMeta">Showing popularity &lt; 50% of top</div>
          </div>
          {isPageLoading ? (
            <div className="moreGrid">
              {skeletonCols.map((col, colIdx) => (
                <div className="moreCol" key={`more-skel-${colIdx}`}>
                  {col.map((i) => (
                    <div className="skeletonCard" key={`skel-${colIdx}-${i}`}>
                      <div className="skeletonLine short" />
                      <div className="skeletonLine" />
                      <div className="skeletonLine" />
                      <div className="skeletonBlock" />
                      <div className="skeletonLine" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="moreGrid" key={page}>
              {moreColumns.map((col, colIdx) => (
                <div className="moreCol" key={`more-col-${colIdx}`}>
                  {col.map((story) => (
                    <Story
                      key={story.id}
                      story={story}
                      bookmarks={bookmarks}
                      handleBookmarkToggle={handleBookmarkToggle}
                      isRemoving={removingIds.has(story.id)}
                      breakingFlash={breakingFlashIds.includes(story.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {moreStories.length > 0 ? (
            <div className="moreActions">
              <div className="pagerRow">
                <button
                  type="button"
                  className="moreButton"
                  onClick={() => {
                    logEvent("pager_prev", { page });
                    pageNavMode.current = "push";
                    setPage((p) => Math.max(0, p - 1));
                  }}
                  disabled={page === 0}
                >
                  Prev
                </button>
                <span className="pageMeta">
                  Page {page + 1} of {maxPage + 1}
                </span>
                <button
                  type="button"
                  className="moreButton"
                  onClick={() => {
                    logEvent("pager_next", { page });
                    pageNavMode.current = "push";
                    setPage((p) => Math.min(maxPage, p + 1));
                  }}
                  disabled={page >= maxPage}
                >
                  Next
                </button>
              </div>
              <div className="filterRow">
                <button
                  type="button"
                  className="moreButton secondary"
                  onClick={() => {
                    setShowBookmarksOnly((v) => {
                      const next = !v;
                      logEvent("toggle_more_bookmarks_only", { on: next });
                      return next;
                    });
                    setPage(0);
                  }}
                  disabled={!bookmarkedIds.length}
                >
                  {showBookmarksOnly ? "Show all" : "Bookmarks only"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <style>{`
        .frontpage {
          margin-top: 18px;
          display: grid;
          gap: 18px;
          align-items: start;
        }

        .col {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .feature {
          grid-column: 2;
        }

        .frontpage article,
        .moreGrid article {
          border: 1px solid var(--rule);
          background: var(--paper);
          padding: 14px 14px 16px;
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.08),
            0 1px 2px rgba(0, 0, 0, 0.06);
          transition: opacity 200ms ease, transform 200ms ease;
        }

        .frontpage .story .row,
        .moreGrid .story .row,
        .frontpage .featureStory .featureTop {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .frontpage .headline,
        .moreGrid .headline {
          margin: 0 0 10px;
          font-size: 18px;
          line-height: 1.35;
          text-wrap: balance;
        }

        .storyMeta {
          margin: 0 0 6px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--muted) 85%, var(--ink) 15%);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .adapterTag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--rule);
          font-size: 9px;
          letter-spacing: 0.12em;
          background: color-mix(in srgb, var(--paper) 92%, var(--ink) 8%);
          color: var(--ink);
        }

        .sourceTag {
          display: inline-flex;
          align-items: center;
          margin-left: 10px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--rule);
          font-size: 9px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          background: color-mix(in srgb, var(--paper) 92%, var(--ink) 8%);
          color: var(--ink);
        }

        .frontpage .content,
        .moreGrid .content {
          display: flow-root;
        }

        .frontpage .pillRow,
        .moreGrid .pillRow {
          display: inline-flex;
          gap: 8px;
          align-items: center;
          margin: 4px 0 6px;
        }

        .frontpage .thumb,
        .moreGrid .thumb {
          width: 100%;
          max-height: 260px;
          object-fit: cover;
          border: 1px solid var(--rule);
          background: #f5f5f5;
        }

        .frontpage .thumb.placeholder,
        .moreGrid .thumb.placeholder {
          object-fit: contain;
          background: color-mix(in srgb, var(--paper) 88%, var(--ink) 4%);
          padding: 12px;
        }

        .frontpage .p,
        .moreGrid .p {
          margin: 0;
          color: var(--ink);
          line-height: 1.65;
          text-wrap: pretty;
        }

        .readMore {
          display: inline;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--link);
          text-decoration: none;
        }

        .readMore:hover {
          text-decoration: underline;
        }

        .frontpage .pageRef,
        .moreGrid .pageRef {
          margin-top: 8px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--muted) 80%, var(--ink) 20%);
        }

        .frontpage .featureStory {
          padding: 14px 14px 16px;
        }

        .frontpage .pill,
        .moreGrid .pill {
          display: inline-block;
          padding: 4px 10px;
          border: 1px solid var(--rule);
          border-radius: 999px;
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 6px;
        }

        .frontpage .pill.breaking,
        .moreGrid .pill.breaking {
          border-color: #b00020;
          color: #b00020;
          background: color-mix(in srgb, #b00020 8%, transparent);
        }

        .frontpage .pill.breaking.flash,
        .moreGrid .pill.breaking.flash {
          animation: breakingFlash 2.1s ease;
          box-shadow:
            0 0 12px rgba(176, 0, 32, 0.8),
            0 0 22px rgba(255, 255, 255, 0.3);
        }

        .frontpage .bookmark,
        .moreGrid .bookmark {
          appearance: none;
          border: 1px solid var(--rule);
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          line-height: 1;
        }

        .frontpage .bookmark[aria-pressed="true"],
        .moreGrid .bookmark[aria-pressed="true"] {
          background: color-mix(in srgb, var(--paper) 80%, var(--link) 8%);
          border-color: var(--link);
        }

        .story.removing {
          opacity: 0;
          transform: translateY(6px);
        }

        .removing {
          opacity: 0 !important;
          transform: translateY(6px);
        }

        .frontpage .empty,
        .frontpage .error,
        .frontpage .loading,
        .loading {
          font-size: 14px;
          color: var(--muted);
        }

        .syncNote {
          margin-bottom: 12px;
          padding: 8px 10px;
          border-left: 2px solid var(--ink);
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .error {
          margin-bottom: 12px;
          color: color-mix(in srgb, var(--ink) 80%, #b00020 20%);
        }

        .story.placeholder .errorTitle {
          font-size: 12px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .story.placeholder .errorText {
          margin: 0 0 12px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--ink);
        }

        .story.placeholder .retryButton {
          appearance: none;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          padding: 8px 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          font-size: 11px;
        }

        .story.placeholder .retryButton:hover {
          background: color-mix(in srgb, var(--paper) 88%, var(--ink) 4%);
        }

        .moreSection {
          margin-top: 26px;
          padding-top: 16px;
          border-top: 1px solid var(--rule);
        }

        .moreHeader {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin-bottom: 14px;
        }

        .moreTitle {
          font-size: 14px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .moreMeta {
          font-size: 12px;
          color: var(--muted);
        }

        .moreGrid {
          display: grid;
          gap: 18px;
          align-items: start;
          animation: fadeIn 220ms ease;
        }

        .skeletonCard {
          border: 1px solid var(--rule);
          background: var(--paper);
          padding: 14px;
          display: grid;
          gap: 10px;
        }

        .skeletonLine,
        .skeletonBlock {
          background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--paper) 88%, var(--ink) 6%),
            color-mix(in srgb, var(--paper) 78%, var(--ink) 12%),
            color-mix(in srgb, var(--paper) 88%, var(--ink) 6%)
          );
          background-size: 200% 100%;
          animation: shimmer 1.2s ease infinite;
        }

        .skeletonLine {
          height: 10px;
          border-radius: 6px;
        }

        .skeletonLine.short {
          width: 55%;
        }

        .skeletonBlock {
          height: 120px;
          border-radius: 6px;
        }

        .moreCol {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .moreActions {
          margin-top: 14px;
          display: grid;
          gap: 10px;
          justify-items: center;
        }

        .pagerRow {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .filterRow {
          display: flex;
          justify-content: center;
        }

        .moreButton {
          appearance: none;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          padding: 10px 16px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          cursor: pointer;
          min-width: 90px;
        }
        .moreButton.secondary {
          background: color-mix(in srgb, var(--paper) 92%, var(--ink) 3%);
        }
        .moreButton:hover {
          background: color-mix(in srgb, var(--paper) 88%, var(--ink) 4%);
        }
        .moreButton:focus-visible {
          outline: 2px solid color-mix(in srgb, var(--link) 55%, transparent);
          outline-offset: 3px;
        }
        .moreButton:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .moreButton.secondary:disabled {
          background: color-mix(in srgb, var(--paper) 94%, var(--ink) 2%);
        }

        .pageMeta {
          font-size: 12px;
          color: var(--muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 100% 50%; }
        }

        @keyframes breakingFlash {
          0% {
            transform: scale(1);
          }
          40% {
            transform: scale(1.05);
          }
          100% {
            transform: scale(1);
          }
        }

        /* Desktop side-by-side content */
        @media (min-width: 860px) {
          .frontpage {
            grid-template-columns: repeat(${topColCount}, minmax(0, 1fr));
          }
          .moreGrid {
            grid-template-columns: repeat(${topColCount}, minmax(0, 1fr));
          }
          .frontpage .thumb.left,
          .moreGrid .thumb.left {
            float: left;
            width: 52%;
            max-width: 280px;
            margin: 2px 10px 6px 0;
          }
          .frontpage .thumb.right,
          .moreGrid .thumb.right {
            float: right;
            width: 52%;
            max-width: 280px;
            margin: 2px 0 6px 10px;
          }
        }

        /* Stack on smaller screens */
        @media (max-width: 1024px) {
          .frontpage {
            grid-template-columns: 1fr;
          }
          .feature {
            grid-column: auto;
          }
          .moreGrid {
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          }
          .moreCol { width: 100%; }
        }

        @media (max-width: 859px) {
          .frontpage .thumb,
          .moreGrid .thumb {
            float: none;
            width: 100%;
            max-width: none;
            margin: 0 0 10px;
          }
        }
      `}</style>
    </section>
  );
}

/* -----------------------------
   Bookmark button
------------------------------ */

function BookmarkButton({ story, bookmarks, onToggle }) {
  const saved = !!bookmarks?.has?.(story?.id);

  return (
    <button
      className="bookmark"
      type="button"
      aria-pressed={saved}
      title={saved ? "Remove bookmark" : "Bookmark"}
      onClick={() => {
        if (!story?.id) return;
        const doToggle = () => bookmarks?.toggle?.(story.id, story);
        if (onToggle) onToggle(saved, doToggle, story);
        else doToggle();
      }}
    >
      {saved ? "★" : "☆"}
    </button>
  );
}

function getAdapterTag(story) {
  const id = String(story?.id ?? "");
  if (id.startsWith("gdelt:")) return "GDELT";
  if (id.startsWith("newsapi:")) return "NEWSAPI.AI";
  return "";
}

const StoryMeta = React.memo(function StoryMeta({ source, publishDate, adapterTag }) {
  if (!source && !publishDate && !adapterTag) return null;
  const label = [source, formatDate(publishDate)].filter(Boolean).join(" · ");
  return (
    <div className="storyMeta">
      {label}
      {adapterTag ? <span className="adapterTag">{adapterTag}</span> : null}
    </div>
  );
});

/* -----------------------------
   Story block
------------------------------ */

const Story = React.memo(function Story({ story, bookmarks, handleBookmarkToggle, isRemoving, forceFeatured, breakingFlash }) {
  const isPlaceholder = !!story.isPlaceholder;
  const placeholderState = story.placeholderState;
  const floatClass = story.imageFloat === "right" ? "right" : "left";
  const hideImage = !!story.isPlaceholder;
  const fallbackIcon = getCategoryIconPath(story?.kicker);
  const imageSrc = story.imageUrl || fallbackIcon;
  const imageIsPlaceholder = !story.imageUrl;

  if (isPlaceholder && placeholderState === "loading") {
    return (
      <article className="story placeholder">
        <div className="row">
          <div className="kicker">{story.kicker}</div>
        </div>
        <div className="skeletonLine short" />
        <div className="skeletonLine" />
        <div className="skeletonLine" />
        <div className="skeletonBlock" />
        <div className="skeletonLine" />
      </article>
    );
  }

  if (isPlaceholder && placeholderState === "error") {
    return (
      <article className="story placeholder">
        <div className="row">
          <div className="kicker">{story.kicker}</div>
        </div>
        <div className="errorTitle">Connection error</div>
        <p className="errorText">
          Try again or contact site administrator at support@happeningnow.news.
        </p>
        {typeof story.onRetry === "function" ? (
          <button
            className="retryButton"
            type="button"
            onClick={() => story.onRetry()}
          >
            Try again
          </button>
        ) : null}
      </article>
    );
  }

  return (
    <article className={`story ${story.isPlaceholder ? "placeholder" : ""} ${isRemoving ? "removing" : ""}`}>
      <div className="row">
        <div className="kicker">{story.kicker}</div>
        {!isPlaceholder ? (
          <BookmarkButton
            story={story}
            bookmarks={bookmarks}
            onToggle={(saved, toggle, item) => handleBookmarkToggle?.(item, saved, toggle)}
          />
        ) : null}
      </div>
      {!isPlaceholder ? (
        <StoryMeta
          source={story.source}
          publishDate={story.publishDate}
          adapterTag={getAdapterTag(story)}
        />
      ) : null}

      <h3 className="headline">{story.title}</h3>

      {(forceFeatured || story.featured || story.breaking) ? (
        <div className="pillRow">
          {forceFeatured || story.featured ? <div className="pill">Featured</div> : null}
          {story.breaking ? (
            <div className={`pill breaking ${breakingFlash ? "flash" : ""}`}>Breaking</div>
          ) : null}
        </div>
      ) : null}

      <div className="content">
        {!hideImage ? (
          <img
            className={`thumb ${floatClass} ${imageIsPlaceholder ? "placeholder" : ""}`}
            src={imageSrc}
            alt=""
            loading="lazy"
            onError={(event) => {
              const target = event.currentTarget;
              if (target.dataset.fallback === "true") return;
              target.dataset.fallback = "true";
              target.src = fallbackIcon;
              target.classList.add("placeholder");
            }}
          />
        ) : null}
        {story.summary ? (
          <p className="p">
            {story.summary}
            {!isPlaceholder && story.url ? (
              <>
                {" "}
                <a
                  className="readMore"
                  href={story.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  [Read More]...
                </a>
              </>
            ) : null}
          </p>
        ) : !isPlaceholder && story.url ? (
          <p className="p">
            <a
              className="readMore"
              href={story.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              [Read More]...
            </a>
          </p>
        ) : null}
      </div>

      {story.pageRef ? (
        <div className="pageRef">— {story.pageRef}</div>
      ) : null}
    </article>
  );
});
