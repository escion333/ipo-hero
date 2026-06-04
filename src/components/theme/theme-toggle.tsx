import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "../ui/button";
import { applyTheme, getStoredTheme, type Theme } from "../../lib/theme";

const ORDER: Theme[] = ["system", "light", "dark"];
const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;
const LABELS = {
  system: "Theme: system",
  light: "Theme: light",
  dark: "Theme: dark",
} as const;

/** Cycles system → light → dark. System follows prefers-color-scheme. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const Icon = ICONS[theme];

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    applyTheme(next);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`${LABELS[theme]}. Activate to change.`}
      title={LABELS[theme]}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
