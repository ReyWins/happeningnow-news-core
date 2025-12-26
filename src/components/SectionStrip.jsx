const KEY = "hn_selected_categories";
window.dispatchEvent(new CustomEvent("hn-sections-change"));

function slugify(label = "") {
  return String(label)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Map “display label” -> canonical key (fixes mismatch bugs)
function canonicalKey(label) {
  const s = slugify(label);
  if (s.includes("global") || s.includes("politic")) return "global-politics";
  if (s.includes("health")) return "health";
  if (s.includes("entertainment")) return "entertainment";
  return s; // fallback
}

export default function SectionStripGate({ data }) {
  const sections = data?.sections ?? [];

  const items = useMemo(() => {
    return sections.map((s) => ({
      label: s.label,
      key: canonicalKey(s.label),
      pageRef: s.stories?.[0]?.pageRef ?? "",
    }));
  }, [sections]);

  const [selected, setSelected] = useState([]);

  // init from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
      if (Array.isArray(saved)) setSelected(saved.slice(0, 3));
    } catch {}
  }, []);

  // persist + broadcast
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(selected));
    } catch {}
    window.dispatchEvent(new CustomEvent("hn-sections-change", { detail: selected }));
  }, [selected]);

  const toggle = (key) => {
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((x) => x !== key);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, key];
    });
  };

  return (
    <section className="strip" aria-label="Sections">
      {items.map((it, i) => {
        const active = selected.includes(it.key);

        return (
          <React.Fragment key={it.key}>
            <button
              type="button"
              className={`item ${active ? "active" : ""}`}
              onClick={() => toggle(it.key)}
              aria-pressed={active}
              title={active ? "Unselect" : "Select (max 3)"}
            >
              <div className="label">{it.label}</div>
              <div className="meta">{it.pageRef}</div>
            </button>

            {i < items.length - 1 && <div className="divider" aria-hidden="true" />}
          </React.Fragment>
        );
      })}

      <style>{`
        .strip {
          margin-top: 12px;
          padding-top: 8px;
          border-top: 2px solid var(--ink);
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
          align-items: start;
          gap: 14px;
        }

        .item {
          text-align: left;
          background: transparent;
          border: 0;
          padding: 6px 0;
          cursor: pointer;
          color: inherit;
          opacity: 0.85;
        }

        .item:hover { opacity: 1; }

        .item.active {
          opacity: 1;
          text-decoration: underline;
          text-underline-offset: 4px;
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
          height: 100%;
          justify-self: center;
        }

        @media (max-width: 900px) {
          .strip {
            grid-auto-flow: row;
          }
          .divider {
            display: none;
          }
        }
      `}</style>
    </section>
  );
}
