export type EnvMap = Record<string, string | undefined>;

const PLACEHOLDER_VALUES = new Set([
  "changeme",
  "change_me",
  "example",
  "placeholder",
  "replace_me",
  "todo",
  "your_key",
  "your_api_key",
  "your_real_key",
  "your_real_api_key"
]);

export function cleanEnvValue(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isConfiguredSecretValue(value: string | undefined): boolean {
  const clean = cleanEnvValue(value);
  if (!clean) return false;
  const lower = clean.toLowerCase();
  if (PLACEHOLDER_VALUES.has(lower)) return false;
  if (lower.startsWith("paste_") && lower.endsWith("_here")) return false;
  if (lower.startsWith("your_") && lower.endsWith("_here")) return false;
  if (lower.includes("paste_") && lower.includes("_key_here")) return false;
  return true;
}

export function hasConfiguredEnv(env: EnvMap, key: string): boolean {
  return isConfiguredSecretValue(env[key]);
}

export function hasAnyConfiguredEnv(env: EnvMap, keys: string[]): boolean {
  return keys.some((key) => hasConfiguredEnv(env, key));
}

export function configuredEnvKeys(env: EnvMap, keys: string[]): string[] {
  return keys.filter((key) => hasConfiguredEnv(env, key));
}

export function firstConfiguredEnv(env: EnvMap, keys: string[]): string {
  for (const key of keys) {
    const value = cleanEnvValue(env[key]);
    if (isConfiguredSecretValue(value)) return value;
  }
  return "";
}
