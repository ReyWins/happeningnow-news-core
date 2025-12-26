import type { Edition, NewsAdapter } from "../types";
import { matchesQuery } from "../normalize";
import data from "../../../data/mockNews.json";

export const mockAdapter: NewsAdapter = async ({ q } = {}) => {
  const sections = (data.sections ?? [])
    .map((section: any) => {
      const stories = (section.stories ?? []).filter((story: any) => {
        const hay =
          `${section.label} ${story.kicker ?? ""} ` +
          `${story.title ?? ""} ${story.summary ?? ""}`;
        return matchesQuery(hay, q);
      });
      return { ...section, stories };
    })
    .filter((section: any) => (section.stories ?? []).length > 0);

  const edition: Edition = {
    meta: data.meta ?? {},
    sections,
  };

  return edition;
};
