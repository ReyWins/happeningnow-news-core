import type { MiddlewareHandler } from "astro";

export const onRequest: MiddlewareHandler = async (context, next) => {
  const path = context.url.pathname;
  if (path.startsWith("/keystatic")) {
    const localAccess =
      import.meta.env.DEV ||
      String(process.env.KEYSTATIC_PREVIEW_ENABLED ?? "").toLowerCase() === "true";
    if (!localAccess) {
      return new Response(null, { status: 404 });
    }
  }

  return next();
};
