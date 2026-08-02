import { Sun, Moon } from "lucide-react";
import { buttonClass } from "@ops-forward/keel";
import { useTheme } from "../hooks/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className={buttonClass({ variant: "secondary", size: "md" })}
      aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
      title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
    >
      {theme === "light" ? (
        <Moon size={20} strokeWidth={1.75} className="!w-4 !h-4" />
      ) : (
        <Sun size={20} strokeWidth={1.75} className="!w-4 !h-4" />
      )}
    </button>
  );
}
