"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const PROBE_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 4_000;

/**
 * Connectivity detection for offline mode. navigator.onLine only reflects
 * whether the device has a network interface up (e.g. still reports true on
 * a Wi-Fi network with no real internet), so it's combined with a cheap
 * active probe against Supabase — a real request is the only reliable way
 * to know the backend is actually reachable.
 *
 * Flips to online only after one successful probe (debounced) to avoid
 * banner flicker on a flaky reconnect.
 */
export function useOnlineStatus(): { isOnline: boolean } {
  const [isOnline, setIsOnline] = useState(true);
  const probingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);

    let cancelled = false;

    async function probe() {
      if (probingRef.current) return;
      probingRef.current = true;
      try {
        const supabase = createClient();
        const { error } = await supabase
          .from("products")
          .select("id", { head: true, count: "exact" })
          .limit(1)
          .abortSignal(AbortSignal.timeout(PROBE_TIMEOUT_MS));
        if (!cancelled) setIsOnline(!error);
      } catch {
        if (!cancelled) setIsOnline(false);
      } finally {
        probingRef.current = false;
      }
    }

    function handleOnline() {
      void probe();
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (navigator.onLine) void probe();
    const interval = window.setInterval(() => {
      if (navigator.onLine) void probe();
    }, PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(interval);
    };
  }, []);

  return { isOnline };
}
