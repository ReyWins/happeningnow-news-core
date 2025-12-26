import React, { useEffect, useMemo, useState } from "react";
import { CATEGORIES, DEFAULT_CATEGORY_IDS } from "../data/categories";

const LS_KEY = "hn_selected_categories";
const TOP_ROW_KEY = "hn_top_row_kickers";
const EVT = "hn-sections-change";
const CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id));

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

function loadTopRowKickers() {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(TOP_ROW_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
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

function findExactSectionMatch(sections, desiredLabel) {
  const want = normalizeKey(desiredLabel);
  return sections.find((s) => normalizeKey(s.label) === want) ?? null;
}

function makePlaceholderSection(label) {
  return {
    label,
    stories: [
      {
        id: `placeholder-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        isPlaceholder: true,
        kicker: label,
        title: "Could not find any headlines…",
        summary:
          "This category isn’t mapped in mockNews.json yet. When we wire APIs, real headlines will appear here.",
        imageUrl: "",
        imageFloat: "left",
        pageRef: "",
        featured: false,
      },
    ],
  };
}

function flatten(sections = []) {
  return (sections ?? []).flatMap((section) =>
    (section.stories ?? []).map((story) => ({
      ...story,
      kicker: story.kicker ?? section.label ?? "",
      __sectionLabel: section.label ?? "",
      __pageRef: story.pageRef ?? section.stories?.[0]?.pageRef ?? "",
    }))
  );
}

export default function SectionStripGate({ data }) {
  const sections = data?.sections ?? [];

  const [selectedIds, setSelectedIds] = useState(() =>
    DEFAULT_CATEGORY_IDS.slice(0, 3)
  );
  const [topRowKickers, setTopRowKickers] = useState(() => []);
  const [hasHydrated, setHasHydrated] = useState(false);
  const selectedLabels = useMemo(
    () => selectedIds.map(idToLabel),
    [selectedIds]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSelectedIds(loadSelected().slice(0, 3));
    setTopRowKickers(loadTopRowKickers());
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSelection = () => setSelectedIds(loadSelected().slice(0, 3));
    window.addEventListener(EVT, syncSelection);
    window.addEventListener("storage", syncSelection);
    return () => {
      window.removeEventListener(EVT, syncSelection);
      window.removeEventListener("storage", syncSelection);
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const handler = (e) => {
      const next = Array.isArray(e?.detail) ? e.detail : [];
      setTopRowKickers(next);
    };
    window.addEventListener("hn-top-row-change", handler);
    return () => window.removeEventListener("hn-top-row-change", handler);
  }, [hasHydrated]);

  const selectedSet = new Set(selectedLabels);
  const uniqueTop = Array.from(new Set(topRowKickers.filter(Boolean)))
    .filter((label) => selectedSet.has(label));
  const preferredLabels =
    uniqueTop.length === selectedLabels.length ? uniqueTop : selectedLabels;

  if (preferredLabels.length === 0) return null;

  const orderedStripItems = useMemo(() => {
    return preferredLabels
      .map((label) => {
        const match = findExactSectionMatch(sections, label);
        const sec = match ?? makePlaceholderSection(label);
        const pageRef = sec.stories?.[0]?.pageRef ?? "";
        return { label: sec.label || label, pageRef };
      })
      .filter((item) => item.label);
  }, [sections, preferredLabels]);

  return (
    <section className="strip" aria-label="Sections">
      {orderedStripItems.map((item, i) => (
        <React.Fragment key={`${item.label}-${i}`}>
          <div className="item">
            <div className="label">{item.label}</div>
            <div className="meta">{item.pageRef}</div>
          </div>
          {i < orderedStripItems.length - 1 && (
            <div className="divider" aria-hidden="true" />
          )}
        </React.Fragment>
      ))}

      <style>{`
        .strip {
          margin-top: 12px;
          padding-top: 8px;
          border-top: 1px solid var(--ink);
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .item {
          flex: 1;
          text-align: center;
        }
        .label {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .meta {
          margin-top: 4px;
          font-size: 10px;
          letter-spacing: 0.12em;
          color: var(--muted);
          text-transform: uppercase;
        }
        .divider {
          width: 1px;
          background: var(--rule);
          height: 26px;
          align-self: center;
        }
        @media (max-width: 900px) {
          .strip { display: none; }
        }
      `}</style>
    </section>
  );
}
