const SCRIPT_ESCAPE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029"
};

/** Serializes JSON so persisted text cannot terminate an application/ld+json script element. */
export function serializeJsonLd(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  return json.replace(/[<>&\u2028\u2029]/g, (character) => SCRIPT_ESCAPE[character]);
}
