import type { TeamForm } from "@/lib/sports/types";

export function FormGuide({ form }: { form: TeamForm }) {
  return (
    <div className="form-guide" aria-label="Recent form">
      {form.recentResults.map((result, index) => (
        <span className={`form-dot ${result}`} key={`${result}-${index}`}>
          {result}
        </span>
      ))}
    </div>
  );
}
