"use client";

import Link from "next/link";
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReportWebVitals } from "next/web-vitals";
import {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_PREFERENCES_EVENT,
  type AnalyticsEvent,
  type AnalyticsMetadata,
  trackEvent
} from "@/lib/analytics/events";

type ConsentChoice = "granted" | "denied";

const measurementId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID?.trim();
const customEndpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
const analyticsConfigured = Boolean(measurementId || customEndpoint);

function ensureGtag() {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
}

function updateGoogleConsent(choice: ConsentChoice) {
  ensureGtag();
  window.gtag?.("consent", "update", {
    analytics_storage: choice,
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    functionality_storage: "granted",
    security_storage: "granted"
  });
}

function persistConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, choice);
  } catch {
    // A blocked localStorage should not prevent the visitor from using the site.
  }
}

function clearGoogleAnalyticsCookies() {
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name === "_ga" || name?.startsWith("_ga_")) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${window.location.hostname}; SameSite=Lax`;
    }
  }
}

function metadataFromElement(element: HTMLElement): AnalyticsMetadata {
  const metadata: AnalyticsMetadata = {};
  for (const [key, value] of Object.entries(element.dataset)) {
    if (!key.startsWith("analytics") || key === "analyticsEvent" || value === undefined) continue;
    const name = key
      .slice("analytics".length)
      .replace(/^[A-Z]/, (letter) => letter.toLowerCase())
      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    metadata[name] = value;
  }
  return metadata;
}

function ProductEventTracker() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const tracked = target?.closest<HTMLElement>("[data-analytics-event]");
      if (tracked?.dataset.analyticsEvent) {
        trackEvent(tracked.dataset.analyticsEvent as AnalyticsEvent, metadataFromElement(tracked));
      }

      const link = target?.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      try {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin && ["http:", "https:"].includes(url.protocol)) {
          trackEvent("outbound_link_clicked", { destination_host: url.hostname });
        }
      } catch {
        // Ignore malformed or non-web links.
      }
    }

    function onChange(event: Event) {
      const target = event.target instanceof HTMLSelectElement ? event.target : null;
      if (!target?.dataset.analyticsEvent) return;
      trackEvent(target.dataset.analyticsEvent as AnalyticsEvent, {
        ...metadataFromElement(target),
        selected_value: target.value || "all"
      });
    }

    function onSubmit(event: SubmitEvent) {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.dataset.analyticsEvent) return;
      const data = new FormData(form);
      const metadata = metadataFromElement(form);
      for (const field of ["date", "sport", "league", "country", "confidence"]) {
        const value = data.get(field);
        if (typeof value === "string" && value) metadata[`filter_${field}`] = value;
      }
      trackEvent(form.dataset.analyticsEvent as AnalyticsEvent, metadata);
    }

    document.addEventListener("click", onClick);
    document.addEventListener("change", onChange);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("change", onChange);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  return null;
}

function WebVitalsTracker() {
  useReportWebVitals((metric) => {
    trackEvent("web_vital", {
      metric_name: metric.name,
      metric_value: Math.round(metric.name === "CLS" ? metric.value * 1000 : metric.value),
      metric_rating: metric.rating,
      navigation_type: metric.navigationType
    });
  });
  return null;
}

export function AnalyticsPreferencesButton() {
  if (!analyticsConfigured) return null;
  return (
    <button
      className="footer-link-button"
      type="button"
      onClick={() => window.dispatchEvent(new Event(ANALYTICS_PREFERENCES_EVENT))}
    >
      Analytics choices
    </button>
  );
}

export function Analytics() {
  const pathname = usePathname() ?? "/";
  const previousPath = useRef<string | null>(null);
  const [choice, setChoice] = useState<ConsentChoice | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!analyticsConfigured) return;
    ensureGtag();
    window.gtag?.("consent", "default", {
      analytics_storage: "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      functionality_storage: "granted",
      security_storage: "granted",
      wait_for_update: 500
    });
    window.gtag?.("set", "ads_data_redaction", true);

    let stored: ConsentChoice | null = null;
    try {
      const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
      if (value === "granted" || value === "denied") stored = value;
    } catch {
      // Treat unavailable storage as no saved preference.
    }

    const globalPrivacyControl = Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
    if (!stored && globalPrivacyControl) {
      stored = "denied";
      persistConsent(stored);
    }
    if (stored) updateGoogleConsent(stored);
    setChoice(stored);
  }, []);

  useEffect(() => {
    function openPreferences() {
      setPreferencesOpen(true);
    }
    window.addEventListener(ANALYTICS_PREFERENCES_EVENT, openPreferences);
    return () => window.removeEventListener(ANALYTICS_PREFERENCES_EVENT, openPreferences);
  }, []);

  // When the panel is re-opened from the footer button, move focus into it,
  // allow Escape to dismiss, and restore focus to the trigger on close.
  useEffect(() => {
    if (!preferencesOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(".button.primary, button, a[href]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreferencesOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus?.();
    };
  }, [preferencesOpen]);

  useEffect(() => {
    if (choice !== "granted" || !googleReady || !measurementId) return;
    const previous = previousPath.current;
    window.gtag?.("event", "page_view", {
      page_title: document.title,
      page_location: `${window.location.origin}${pathname}`,
      ...(previous ? { page_referrer: `${window.location.origin}${previous}` } : {})
    });

    const match = pathname.match(/^\/predictions\/([^/]+)$/);
    if (match && !["value-picks", "history", "decision-engine", "bet-slip"].includes(match[1])) {
      trackEvent("prediction_viewed", { match_id: decodeURIComponent(match[1]) });
    }
    previousPath.current = pathname;
  }, [choice, googleReady, pathname]);

  useEffect(() => {
    if (choice !== "granted") return;
    const onError = (event: ErrorEvent) => {
      trackEvent("client_error", { error_kind: event.error?.name ?? "window_error" });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      trackEvent("client_error", { error_kind: reason instanceof Error ? reason.name : "unhandled_rejection" });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [choice]);

  const choose = useCallback((nextChoice: ConsentChoice) => {
    persistConsent(nextChoice);
    updateGoogleConsent(nextChoice);
    if (nextChoice === "denied") clearGoogleAnalyticsCookies();
    setChoice(nextChoice);
    setPreferencesOpen(false);
  }, []);

  if (!analyticsConfigured) return null;

  const showConsent = choice === null || preferencesOpen;

  return (
    <>
      {measurementId && choice === "granted" ? (
        <Script
          id="google-analytics"
          src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
          strategy="afterInteractive"
          onLoad={() => {
            ensureGtag();
            window.gtag?.("js", new Date());
            window.gtag?.("config", measurementId, {
              send_page_view: false,
              allow_google_signals: false,
              allow_ad_personalization_signals: false,
              cookie_flags: "SameSite=Lax;Secure"
            });
            setGoogleReady(true);
          }}
        />
      ) : null}

      <ProductEventTracker />
      <WebVitalsTracker />

      {showConsent ? (
        <section
          className="analytics-consent"
          ref={dialogRef}
          role="region"
          aria-labelledby="analytics-consent-title"
        >
          <div>
            <span className="section-kicker">Your privacy, your call</span>
            <h2 id="analytics-consent-title">Help us improve OddsPadi?</h2>
            <p>
              With your permission, we use Google Analytics to understand which pages help, where the app feels slow,
              and which features people use. We do not enable advertising tracking or send your email, posts, searches,
              or betting activity. Read our <Link href="/privacy">privacy notice</Link>.
            </p>
          </div>
          <div className="analytics-consent-actions">
            <button className="button" type="button" onClick={() => choose("denied")}>
              {choice === "granted" ? "Turn off analytics" : "No thanks"}
            </button>
            <button className="button primary" type="button" onClick={() => choose("granted")}>
              Allow analytics
            </button>
            {choice !== null ? (
              <button className="analytics-consent-close" type="button" onClick={() => setPreferencesOpen(false)}>
                Keep current choice
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
