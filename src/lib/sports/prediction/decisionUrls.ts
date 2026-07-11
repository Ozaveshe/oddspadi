const LOCAL_DECISION_ENGINE_ORIGIN = "http://127.0.0.1:3025";

type EnvLike = Record<string, string | undefined>;

function cleanOrigin(value: string | undefined): string | null {
  const cleaned = value?.trim().replace(/\/$/, "");
  return cleaned || null;
}

export function decisionSiteOrigin(env: EnvLike = process.env): string {
  return cleanOrigin(env.NEXT_PUBLIC_SITE_URL) ?? cleanOrigin(env.URL) ?? cleanOrigin(env.DEPLOY_URL) ?? LOCAL_DECISION_ENGINE_ORIGIN;
}

export function decisionApiUrl(path: string, origin = decisionSiteOrigin()): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin.replace(/\/$/, "")}${normalizedPath}`;
}

export function decisionCurlCommand(path: string, origin = decisionSiteOrigin()): string {
  return `curl.exe -sS "${decisionApiUrl(path, origin)}"`;
}
