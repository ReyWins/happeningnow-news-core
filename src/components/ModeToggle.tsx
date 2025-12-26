import { useEffect, useState } from "react";

type Mode = "light" | "dark";

const SunIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
    <path
      d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
      stroke="currentColor"
      strokeWidth="1.75"
    />
    <path d="M12 2v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M12 20v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M4.93 4.93 6.34 6.34" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M17.66 17.66 19.07 19.07" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M2 12h2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M20 12h2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M4.93 19.07 6.34 17.66" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M17.66 6.34 19.07 4.93" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
    <path
      d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
    />
  </svg>
);

function applyMode(mode: Mode) {
  if (typeof document === "undefined") return;

  localStorage.setItem("mode", mode);
  document.documentElement.dataset.mode = mode;
  document.documentElement.dataset.modePref = mode;
}

export default function ModeToggle() {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const saved = localStorage.getItem("mode");
    if (saved === "light" || saved === "dark") {
      setMode(saved);
      applyMode(saved);
      return;
    }

    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const initial: Mode = prefersDark ? "dark" : "light";
    setMode(initial);
    applyMode(initial);
  }, []);

  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  // ✅ one click toggles
  const toggleMode = () => {
    setMode((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <button
      type="button"
      className="modeToggle"
      onClick={toggleMode}
      aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
      title={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
    >
      {mode === "light" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}