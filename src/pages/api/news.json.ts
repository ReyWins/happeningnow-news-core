import type { APIRoute } from "astro";
import { gdeltAdapter, mockAdapter, newsApiAdapter } from "../../lib/news";
import { sanitizeQuery } from "../../lib/news/normalize";
import { getCachedEdition } from "../../lib/news/cache";
import { getFrontPageEdition } from "../../lib/news/frontpage";
import { DEFAULT_CATEGORY_IDS } from "../../data/categories";

const CACHE_TTL_MS = 120_000;
const FALLBACK_TTL_MS = 24 * 60 * 60 * 1000;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const rawQ = url.searchParams.get("q") ?? "";
  const categoriesParam = url.searchParams.get("categories") ?? "";
  const { query: q, valid } = sanitizeQuery(rawQ);
  const fetchedAt = Date.now();

  if (rawQ && !valid) {
    return new Response(
      JSON.stringify({ sections: [], debug: { q, invalid: true } }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
        },
      }
    );
  }

  const envAdapter = process.env.NEWS_ADAPTER;
  const adapterName =
    envAdapter === "mock"
      ? "mock"
      : envAdapter === "gdelt"
        ? "gdelt"
        : "newsapi";
  const adapter =
    adapterName === "gdelt"
      ? gdeltAdapter
      : adapterName === "newsapi"
        ? newsApiAdapter
        : mockAdapter;
  const categoryIds = categoriesParam
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const useCategoryHints = !rawQ && categoryIds.length > 0;
  const fallbackOptions =
    adapterName === "newsapi"
      ? {
          fallbackAdapter: gdeltAdapter,
          fallbackAdapterName: "gdelt",
          fallbackTtlMs: FALLBACK_TTL_MS,
        }
      : {};

  const edition = useCategoryHints
    ? await getFrontPageEdition({
        adapter,
        adapterName,
        ttlMs: CACHE_TTL_MS,
        categoryIds: categoryIds.length ? categoryIds : DEFAULT_CATEGORY_IDS,
        fallbackTtlMs: FALLBACK_TTL_MS,
      })
    : await getCachedEdition(
        `news:${adapterName}:${q}`,
        CACHE_TTL_MS,
        async () => {
          const primary = await adapter({ q });
          const hasStories =
            primary.sections?.some(
              (section) => (section.stories?.length ?? 0) > 0
            ) ?? false;
          if (hasStories || !fallbackOptions.fallbackAdapter) {
            return primary;
          }
          if (fallbackOptions.fallbackAdapterName) {
            return await getCachedEdition(
              `news:${fallbackOptions.fallbackAdapterName}:${q}`,
              fallbackOptions.fallbackTtlMs ?? CACHE_TTL_MS,
              () => fallbackOptions.fallbackAdapter({ q })
            );
          }
          return fallbackOptions.fallbackAdapter({ q });
        }
      );

  return new Response(
    JSON.stringify({
      ...edition,
      meta: {
        ...(edition.meta ?? {}),
        fetchedAt,
      },
      debug: {
        q,
        categories: useCategoryHints ? categoryIds : undefined,
        fullUrl: url.toString(),
      },
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
      },
    }
  );
};
