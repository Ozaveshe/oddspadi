import type { TeamForm } from "@/lib/sports/types";

const RESULT_WORDS: Record<string, string> = { W: "won", D: "drew", L: "lost" };

function spokenForm(results: readonly string[]): string {
  if (!results.length) return "No recent form recorded";
  return `Recent form, most recent first: ${results
    .map((result) => RESULT_WORDS[result.toUpperCase()] ?? result)
    .join(", ")}`;
}

/**
 * The result letters are a visual shorthand — read one glyph at a time they are
 * meaningless ("W D L"), and the container's `aria-label` was attached to a
 * role-less <div> so it was discarded outright. `role="img"` makes the spoken
 * sentence the element's content and hides the individual dots.
 */
export function FormGuide({ form }: { form: TeamForm }) {
  return (
    <div className="form-guide" role="img" aria-label={spokenForm(form.recentResults)}>
      {form.recentResults.map((result, index) => (
        <span className={`form-dot ${result}`} key={`${result}-${index}`} aria-hidden="true">
          {result}
        </span>
      ))}
    </div>
  );
}
