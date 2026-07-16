const EXACT_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com"
]);

const PUSH_HOST_SUFFIXES = [".notify.windows.com", ".push.apple.com"];
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function allowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return EXACT_PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "https:" &&
      !endpoint.username &&
      !endpoint.password &&
      allowedPushHost(endpoint.hostname);
  } catch {
    return false;
  }
}

export function isValidPushKey(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    BASE64URL.test(value);
}
