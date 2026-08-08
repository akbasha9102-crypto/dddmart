"use client";

import { useCallback, useState } from "react";
import { isMuted, setMuted } from "@/lib/audio/posSounds";

export function useSoundSettings(): { isMuted: boolean; toggle: () => void } {
  const [muted, setMutedState] = useState(isMuted());

  const toggle = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev;
      setMuted(next);
      return next;
    });
  }, []);

  return { isMuted: muted, toggle };
}
