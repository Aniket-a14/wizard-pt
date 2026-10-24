"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wpt-theme", next);
    } catch {}
    window.dispatchEvent(new Event("wpt-theme"));
  }
  return (
    <button onClick={toggle} aria-label="Toggle light/dark theme" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground">
      <Sun className="hidden size-4 [[data-theme=dark]_&]:block" />
      <Moon className="size-4 [[data-theme=dark]_&]:hidden" />
    </button>
  );
}
