import type { APIRoute } from "astro";
import { newsApiAdapter } from "../../lib/news";

export const GET: APIRoute = async () => {
  const edition = await newsApiAdapter({ q: "bitcoin" });
  return new Response(JSON.stringify(edition), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
};
