import { config, fields, collection, singleton } from "@keystatic/core";

const repo =
  import.meta.env.KEYSTATIC_GITHUB_REPO ?? "ReyWins/happeningnow-news-core";
const isDev = import.meta.env.DEV;
const useGitHub = import.meta.env.KEYSTATIC_STORAGE === "github" && !isDev;

export const keystaticConfig = config({
  storage: useGitHub ? { kind: "github", repo } : { kind: "local" },
  singletons: {
    changelog: singleton({
      label: "Change Log",
      path: "src/content/changelog/index.mdoc",
      schema: {
        title: fields.text({ label: "Title" }),
        description: fields.text({
          label: "Description",
          validation: { length: { min: 0, max: 220 } },
        }),
        date: fields.date({ label: "Date" }),
        author: fields.text({ label: "Author", validation: { isRequired: false } }),
        body: fields.document({ label: "Body", formatting: true, links: true }),
      },
    }),
    about: singleton({
      label: "About",
      path: "src/content/about/index.mdoc",
      schema: {
        title: fields.text({ label: "Title" }),
        description: fields.text({
          label: "Description",
          validation: { length: { min: 0, max: 220 } },
        }),
        updated: fields.date({ label: "Last Updated" }),
        author: fields.text({ label: "Author", validation: { isRequired: false } }),
        body: fields.document({ label: "Body", formatting: true, links: true }),
      },
    }),
    privacy: singleton({
      label: "Privacy",
      path: "src/content/privacy/index.mdoc",
      schema: {
        title: fields.text({ label: "Title" }),
        description: fields.text({
          label: "Description",
          validation: { length: { min: 0, max: 220 } },
        }),
        updated: fields.date({ label: "Last Updated" }),
        author: fields.text({ label: "Author", validation: { isRequired: false } }),
        body: fields.document({ label: "Body", formatting: true, links: true }),
      },
    }),
  },
  collections: {
    blog: collection({
      label: "Blog",
      path: "src/content/blog/*/index.mdoc",
      slugField: "slug",
      schema: {
        title: fields.text({ label: "Title" }),
        slug: fields.slug({ name: { label: "Slug" } }),
        description: fields.text({
          label: "Description",
          validation: { length: { min: 0, max: 220 } },
        }),
        date: fields.date({ label: "Date" }),
        author: fields.text({ label: "Author", validation: { isRequired: false } }),
        summary: fields.text({ label: "Summary" }),
        image: fields.image({
          label: "Hero Image",
          description: "Use a modern format like .webp for faster loads.",
          directory: "public/images/blog",
          publicPath: "/images/blog",
          validation: { isRequired: false },
        }),
        tags: fields.array(fields.text({ label: "Tag" }), {
          label: "Tags",
          itemLabel: (props) => props.value ?? "Tag",
        }),
        body: fields.document({ label: "Body", formatting: true, links: true }),
      },
    }),
  },
});
