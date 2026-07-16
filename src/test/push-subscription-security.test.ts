import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint, isValidPushKey } from "@/lib/security/pushSubscription";

describe("push subscription outbound security", () => {
  it("accepts known browser push service endpoints", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/example-token",
      "https://updates.push.services.mozilla.com/wpush/v2/example-token",
      "https://web.push.apple.com/QKexample-token",
      "https://wns2-par02p.notify.windows.com/w/?token=example"
    ]) expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it("rejects arbitrary, private, credentialed, and non-HTTPS destinations", () => {
    for (const endpoint of [
      "http://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/internal",
      "https://localhost/admin",
      "https://evil.example/push",
      "https://user:password@fcm.googleapis.com/fcm/send/token",
      "javascript:alert(1)"
    ]) expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it("bounds and validates Web Push key material", () => {
    expect(isValidPushKey("A".repeat(87), 40, 256)).toBe(true);
    expect(isValidPushKey("A".repeat(22), 8, 128)).toBe(true);
    expect(isValidPushKey("not valid key material", 8, 128)).toBe(false);
    expect(isValidPushKey("A".repeat(300), 40, 256)).toBe(false);
  });

  it("revalidates stored endpoints before the worker sends anything", async () => {
    const source = await readFile("netlify/functions/push-notification-worker-background.ts", "utf8");
    const validation = source.indexOf("!isAllowedPushEndpoint(subscription.endpoint)");
    expect(validation).toBeGreaterThan(-1);
    expect(validation).toBeLessThan(source.indexOf("webpush.sendNotification"));
  });
});
