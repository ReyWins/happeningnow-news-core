import { defineCollection } from "astro:content";

// Astro content collections are managed via Keystatic. Defining an empty
// collection map prevents Astro from auto-generating collections for every
// folder in src/content (which triggers warnings during dev).
export const collections = {};
