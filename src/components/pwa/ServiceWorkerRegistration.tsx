"use client";
import { useEffect } from "react";
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // The worker cache-firsts .js/.css; against the dev server (unhashed chunk
    // URLs) that serves stale client bundles and breaks HMR, so dev
    // unregisters any previously-installed worker instead of registering.
    const timer = window.setTimeout(() => {
      if (process.env.NODE_ENV !== "production") {
        navigator.serviceWorker
          .getRegistrations?.()
          .then((registrations) => {
            for (const registration of registrations) void registration.unregister();
          })
          .catch(() => undefined);
        return;
      }
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
