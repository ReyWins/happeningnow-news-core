import React, { useEffect, useState } from "react";

const SEARCH_KEY = "hn_search_q";
const COUNT_KEY = "hn_story_count";

const SEARCH_EVT = "hn-search-change";
const COUNT_EVT = "hn-story-count";

export default function SearchGate() {
  const [q, setQ] = useState("");
  const [count, setCount] = useState(0);

  useEffect(() => {
    // init search query
    try {
      setQ(localStorage.getItem(SEARCH_KEY) || "");
    } catch {}

    // init count
    const syncCount = () => {
      try {
        const v = Number(localStorage.getItem(COUNT_KEY) || "0");
        setCount(Number.isFinite(v) ? v : 0);
      } catch {
        setCount(0);
      }
    };

    syncCount();
    window.addEventListener(COUNT_EVT, syncCount);
    return () => window.removeEventListener(COUNT_EVT, syncCount);
  }, []);

  function onChange(val) {
    setQ(val);

    try {
      localStorage.setItem(SEARCH_KEY, val);

      // ✅ send value directly
      window.dispatchEvent(
        new CustomEvent(SEARCH_EVT, { detail: val })
      );
    } catch {}
  }

  return (
    <div className="searchRow">
      <input
        className="searchInput"
        type="search"
        placeholder="Search news by keyword…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
      />

      <div className="searchMeta">{count} STORY(IES)</div>

      <style>{`
        .searchRow{
          margin-top: 10px;
          padding: 10px 0;
          border-top: 1px solid var(--rule);
          border-bottom: 1px solid var(--rule);
          display:flex;
          align-items:center;
          gap: 14px;
        }
        .searchInput{
          flex: 1;
          padding: 10px 12px;
          border: 1px solid var(--rule);
          background: var(--paper);
          color: var(--ink);
          font: inherit;
        }
        .searchMeta{
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--muted);
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
