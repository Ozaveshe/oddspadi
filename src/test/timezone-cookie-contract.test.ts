import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TIMEZONE_COOKIE, TIMEZONE_COOKIE_MAX_AGE, timezoneCookieValue } from "@/lib/time/timezoneCookie";

/**
 * The cookie is written by a client component and read by a server module, and
 * the two cannot share code: `timezoneCookie.ts` imports `next/headers`, which
 * cannot be bundled into a client component. So the attributes are written
 * twice, and a drift between them is silent — the write would simply stop
 * matching the read, the server would fall back to Africa/Lagos, and the
 * picker would look like it does nothing at all. That is the failure this
 * catches.
 */

const CLIENT = readFileSync("src/components/odds/LocalTime.tsx", "utf8");

describe("the client writes the cookie the server reads", () => {
  it("uses the same cookie name on both sides", () => {
    expect(CLIENT, `client must write ${TIMEZONE_COOKIE}`).toContain(`${TIMEZONE_COOKIE}=`);
  });

  it("uses the same lifetime on both sides", () => {
    const written = /max-age=\$\{([^}]+)\}/.exec(CLIENT)?.[1];
    expect(written, "client cookie has no max-age").toBeTruthy();
    // eslint-disable-next-line no-eval -- an arithmetic literal from our own source
    expect(eval(written as string)).toBe(TIMEZONE_COOKIE_MAX_AGE);
  });

  it("agrees with the server's attribute string", () => {
    const server = timezoneCookieValue("Africa/Lagos", true);
    for (const attribute of server.split("; ")) {
      const [name] = attribute.split("=");
      expect(CLIENT, `client is missing the ${name} attribute`).toContain(name);
    }
  });

  it("keeps the cookie readable by script, since the client is what sets it", () => {
    // httpOnly here would mean the picker could never write it. Stated as a
    // test so nobody "hardens" it into being broken.
    expect(timezoneCookieValue("Africa/Lagos", true)).not.toContain("httponly");
  });

  it("marks it secure and same-site so it cannot leak cross-site", () => {
    expect(timezoneCookieValue("Africa/Lagos", true)).toContain("secure");
    expect(timezoneCookieValue("Africa/Lagos", true)).toContain("samesite=lax");
    expect(CLIENT).toContain("samesite=lax");
  });

  it("never writes an unrecognised zone", () => {
    expect(timezoneCookieValue("Mars/Olympus_Mons", false)).toContain("Africa%2FLagos");
  });
});
