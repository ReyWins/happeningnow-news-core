export const prerender = false;

import type { APIRoute } from "astro";
import { mockAdapter, newsApiAdapter } from "../../../lib/news";
import { getCachedEdition } from "../../../lib/news/cache";
import { sanitizeQuery } from "../../../lib/news/normalize";

const CACHE_TTL_MS = 120_000;

export const GET: APIRoute = async ({ params, request }) => {
  const url = new URL(request.url);
  const rawQ = params.q ?? "";
  const { query: q, valid } = sanitizeQuery(rawQ);
  const fetchedAt = Date.now();

  if (!valid) {
    return new Response(
      JSON.stringify({ sections: [], debug: { q, invalid: true } }),
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300"
        }
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
  const cacheKey = `news:${adapterName}:${q}`;
  const edition = await getCachedEdition(cacheKey, CACHE_TTL_MS, () => adapter({ q }));

  return new Response(
    JSON.stringify({
      ...edition,
      meta: {
        ...(edition.meta ?? {}),
        fetchedAt,
      },
      debug: { q, fullUrl: url.toString() },
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300"
      }
    }
  );
};
