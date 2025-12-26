import type { MiddlewareHandler } from "astro";

export const onRequest: MiddlewareHandler = async (context, next) => {
  const path = context.url.pathname;
  if (path.startsWith("/keystatic")) {
    const localAccess =
      import.meta.env.DEV ||
      String(process.env.KEYSTATIC_PREVIEW_ENABLED ?? "").toLowerCase() === "true";
    if (!localAccess) {
      return new Response(
        "<!doctype html><title>Not Found</title><h1>404</h1><p>Not Found</p>",
        {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    }
  }

  return next();
};
