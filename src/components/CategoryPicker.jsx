import React, { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, DEFAULT_CATEGORY_IDS } from "../data/categories";

const LS_KEY = "hn_selected_categories";
const FRONT_CACHE_PREFIX = "hn_frontpage_cache_v1:";
const FRONT_RESET_KEY = "hn_frontpage_cache_reset";

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

function getStoredIds() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return DEFAULT_CATEGORY_IDS;
  const v = safeParse(raw, null);
  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  const cleaned = Array.isArray(v) ? v.filter((id) => categoryIds.has(id)) : DEFAULT_CATEGORY_IDS;
  return cleaned.length > 0 ? cleaned : DEFAULT_CATEGORY_IDS;
}

export default function CategoryPicker({ categories = [], max = 3 }) {
  const categoryIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories]);
  const prevSelectionKey = useRef("");

  const [selected, setSelected] = useState(() => []);
  const [hasHydrated, setHasHydrated] = useState(false);

  const [showPrompt, setShowPrompt] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const prevCount = useRef(selected.length);

  // Hydrate selection after mount to avoid SSR/client mismatch
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = getStoredIds();
    const cleaned = Array.from(
      new Set((stored ?? []).filter((id) => categoryIds.has(id)))
    ).slice(0, max);
    setSelected(cleaned);
    prevCount.current = cleaned.length;
    prevSelectionKey.current = cleaned.join("|");
    setHasHydrated(true);
  }, [categoryIds, max]);

  // Re-clean if list changes after hydration
  useEffect(() => {
    if (!hasHydrated) return;
    setSelected((prev) => prev.filter((id) => categoryIds.has(id)).slice(0, max));
  }, [categoryIds, max, hasHydrated]);

  // Persist
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(selected));
    } catch {}
    const selectionKey = selected.join("|");
    if (prevSelectionKey.current && prevSelectionKey.current !== selectionKey) {
      try {
        Object.keys(localStorage).forEach((key) => {
          if (key.startsWith(FRONT_CACHE_PREFIX)) {
            localStorage.removeItem(key);
          }
        });
        localStorage.setItem(FRONT_RESET_KEY, String(Date.now()));
      } catch {}
    }
    prevSelectionKey.current = selectionKey;
    try {
      window.dispatchEvent(new CustomEvent("hn-sections-change", { detail: selected }));
    } catch {}
  }, [selected]);

  const selectedLabels = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.label]));
    return selected.map((id) => map.get(id) ?? id);
  }, [selected, categories]);

  const remaining = max - selected.length;
  const canProceed = selected.length === max;

  // When user newly reaches max, show prompt (only on transition, not on load)
  useEffect(() => {
    if (!hasHydrated) return;
    const prior = prevCount.current;
    if (prior < max && selected.length === max) {
      setShowPrompt(true);
    }
    prevCount.current = selected.length;
  }, [selected.length, max, hasHydrated]);

  function toggle(id) {
    setSelected((prev) => {
      const has = prev.includes(id);

      // Always allow deselect
      if (has) return prev.filter((x) => x !== id);

      // Only allow select if we have room
      if (prev.length >= max) return prev;

      return [...prev, id];
    });
  }

  function reset() {
    setShowPrompt(false);
    setSelected([]);
    prevCount.current = 0;
  }

  function onConfirmYes() {
    setIsFadingOut(true);
    try {
      sessionStorage.setItem("hn_pagewait_pending", String(Date.now()));
    } catch {}
    // let fade animation play, then redirect
    window.setTimeout(() => {
      window.location.assign("/");
    }, 220);
  }

  function onConfirmNo() {
    setShowPrompt(false);
  }

  const selectionText = selectedLabels.join(", ");

  return (
    <div className={`picker ${isFadingOut ? "fadeOut" : ""}`}>
      <div className="metaRow">
        <div className="meta">
          SELECTED: <strong>{selected.length}</strong> / {max}
          {remaining > 0 ? ` • PICK ${remaining} MORE` : ""}
        </div>

        <div className="actions">
          <button className="linkBtn" type="button" onClick={reset}>
            Reset
          </button>
          <span className="sep">|</span>
          <a
            className={`btn ${canProceed ? "" : "disabled"}`}
            data-pagewait="frontpage"
            href={canProceed ? "/" : "#"}
          >
            View Front Page
          </a>
        </div>
      </div>

      {!canProceed ? (
        <div className="hint">Choose exactly {max} categories to build your edition.</div>
      ) : null}

      <div className="grid">
        {categories.map((c) => {
          const active = selected.includes(c.id);
          const locked = !active && selected.length >= max;

          return (
            <button
              key={c.id}
              type="button"
              className={`card ${active ? "active" : ""} ${locked ? "locked" : ""}`}
              onClick={() => toggle(c.id)}
              aria-pressed={active}
              title={locked ? `You can only select ${max}. Deselect one first.` : ""}
            >
              <div className="labelRow">
                <div className="label">{c.label}</div>
                <div className="mark">{active ? "✓" : ""}</div>
              </div>
              <div className="keywords">{(c.keywords || []).slice(0, 5).join(" • ")}</div>
            </button>
          );
        })}
      </div>

      <div className="note">
        Your selection is saved locally in this browser. Bookmarks are saved separately.
      </div>

      {/* Prompt Modal */}
      {showPrompt ? (
        <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Proceed confirmation">
          <div className="modal">
            <div className="modalKicker">Proceed?</div>
            <div className="modalTitle">You’ve chosen</div>
            <div className="modalBody">“{selectionText}”</div>

            <div className="modalActions">
              <button className="modalBtn" type="button" onClick={onConfirmNo}>
                No
              </button>
              <button className="modalBtn primary" type="button" onClick={onConfirmYes}>
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        /* Page fade technique */
        .picker{
          opacity: 1;
          transition: opacity 220ms ease;
        }
        .picker.fadeOut{
          opacity: 0;
        }

        .metaRow{
          display:flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          border-top: 2px solid var(--ink);
          padding-top: 12px;
        }
        .meta{
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .actions{
          display:flex;
          align-items:center;
          gap: 10px;
        }

        .linkBtn{
          border: none;
          background: transparent;
          padding: 0;
          font: inherit;
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          cursor: pointer;
          color: var(--ink);
          border-bottom: 1px solid var(--ink);
          padding-bottom: 2px;
        }
        .linkBtn:hover{ opacity: .75; }

        .sep{
          font-size: 11px;
          color: var(--muted);
          letter-spacing: .12em;
        }

        .btn{
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          text-decoration: none;
          color: var(--ink);
          border-bottom: 1px solid var(--ink);
          padding-bottom: 2px;
        }
        .btn:hover{ opacity: .75; }
        .btn.disabled{
          pointer-events: none;
          opacity: .35;
          border-bottom-color: transparent;
        }

        .hint{
          margin-top: 10px;
          font-size: 12px;
          color: var(--muted);
          border-left: 2px solid var(--ink);
          padding: 8px 10px;
        }

        .grid{
          margin-top: 14px;
          display:grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
        }

        .card{
          text-align:left;
          border: 1px solid var(--rule);
          background: var(--paper);
          padding: 14px;
          cursor: pointer;
          transition: border-color 140ms ease, opacity 140ms ease, background 140ms ease;
        }
        .card:hover{ border-color: var(--ink); background: color-mix(in srgb, var(--paper) 92%, var(--ink) 6%); }

        .card.active{
          border-color: var(--link);
          outline: 1px solid var(--link);
          color: var(--fg);
        }

        .card.locked{
          opacity: 0.5;
        }

        .labelRow{
          display:flex;
          align-items:flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 8px;
        }

        .label{
          font-size: 13px;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: var(--category-label, var(--ink));
        }

        .mark{
          width: 18px;
          text-align: right;
          font-size: 12px;
          color: var(--ink);
        }

        .keywords{
          font-size: 11px;
          line-height: 1.5;
          color: var(--category-keywords, var(--muted));
          letter-spacing: .06em;
          text-transform: uppercase;
        }

        .note{
          margin-top: 14px;
          font-size: 12px;
          color: var(--muted);
          border-top: 1px solid var(--rule);
          padding-top: 10px;
        }

        /* Modal fade */
        .modalOverlay{
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.25);
          display:flex;
          align-items:center;
          justify-content:center;
          padding: 18px;
          animation: fadeIn 160ms ease;
          z-index: 999;
        }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

        .modal{
          width: min(520px, 100%);
          background: var(--paper);
          border: 2px solid var(--ink);
          padding: 18px;
          text-align: center;
        }
        .modalKicker{
          font-size: 11px;
          letter-spacing: .15em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 10px;
        }
        .modalTitle{
          font-size: 18px;
          letter-spacing: .10em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .modalBody{
          font-size: 14px;
          line-height: 1.6;
          margin-bottom: 16px;
        }
        .modalActions{
          display:flex;
          justify-content:center;
          gap: 10px;
        }
        .modalBtn{
          border: 1px solid var(--ink);
          background: var(--paper);
          color: var(--ink);
          padding: 8px 14px;
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          cursor: pointer;
        }
        .modalBtn:hover{ opacity: .8; }
        .modalBtn.primary{
          background: var(--ink);
          color: var(--paper);
        }

        @media (max-width: 900px){
          .grid{ grid-template-columns: 1fr; }
          .metaRow{ flex-direction: column; align-items:flex-start; }
        }
      `}</style>
    </div>
  );
}
