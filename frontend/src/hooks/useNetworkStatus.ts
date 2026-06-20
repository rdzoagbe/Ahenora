import { useCallback, useEffect, useRef, useState } from 'react';

const HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds
const HEALTH_CHECK_TIMEOUT = 8_000; // 8 seconds

/**
 * Lightweight network status hook.
 * Periodically pings a known public URL to detect connectivity.
 * Falls back to marking offline when consecutive fetch failures occur.
 * No extra dependencies required.
 */
export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const failCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
      // Use a lightweight, CORS-friendly endpoint
      await fetch('https://clients3.google.com/generate_204', {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);
      failCountRef.current = 0;
      setIsConnected(true);
    } catch {
      failCountRef.current += 1;
      // Mark offline after 2 consecutive failures to avoid false positives
      if (failCountRef.current >= 2) {
        setIsConnected(false);
      }
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, HEALTH_CHECK_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check]);

  return { isConnected };
}
