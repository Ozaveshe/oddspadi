import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA and push foundation", () => {
  it("publishes installable maskable raster icons", () => {
    const icons = manifest().icons ?? [];
    expect(icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/brand/oddspadi-icon-192-maskable.png", sizes: "192x192", purpose: "maskable" }),
      expect.objectContaining({ src: "/brand/oddspadi-icon-512-maskable.png", sizes: "512x512", purpose: "maskable" })
    ]));
    expect(statSync("public/brand/oddspadi-icon-192-maskable.png").size).toBeGreaterThan(1000);
    expect(statSync("public/brand/oddspadi-icon-512-maskable.png").size).toBeGreaterThan(1000);
  });

  it("ships offline, caching, push, and notification-click handlers", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    for (const event of ["install", "activate", "fetch", "push", "notificationclick"]) expect(worker).toContain(`addEventListener("${event}"`);
    expect(worker).toContain("/offline");
  });

  it("never caches authenticated pages or API responses", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).not.toContain("DATA_CACHE");
    expect(worker).toContain('if (request.mode === "navigate")');
    expect(worker).toContain('caches.match("/offline")');
    expect(worker).toContain('url.pathname.startsWith("/_next/static/")');
  });

  it("constrains push notification navigation to this origin", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain("function safeNotificationPath(value)");
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).toContain("safeNotificationPath(event.notification.data?.url)");
  });

  it("keeps push copy responsible", () => {
    const worker = readFileSync("netlify/functions/push-notification-worker-background.ts", "utf8").toLowerCase();
    expect(worker).not.toContain("sure odds");
    expect(worker).not.toContain("guaranteed win");
    expect(worker).toContain("padi");
  });
});
