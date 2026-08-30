"use client";

import { MoonStarIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      className="relative size-8"
      onClick={toggleTheme}
      size="icon"
      variant="ghost"
    >
      <MoonStarIcon className="absolute size-4 transition-opacity dark:opacity-0" />
      <SunIcon className="absolute size-4 opacity-0 transition-opacity dark:opacity-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
