"use client";

import { useState } from "react";
import { TRAINING_SCENARIOS, evaluateTrainingChoice } from "@/lib/ops/trainingScenarios";

/**
 * The training sandbox. Every scenario is synthetic and every choice is graded
 * purely in the browser via evaluateTrainingChoice — there is NO network call
 * and NO write. A trainee can click every option without any path to
 * production; the feedback teaches the judgement call.
 */
export function TrainingSandbox() {
  const [feedback, setFeedback] = useState<Record<string, { correct: boolean; feedback: string }>>({});

  function choose(scenarioId: string, optionId: string) {
    const result = evaluateTrainingChoice(scenarioId, optionId);
    if (result) setFeedback((prev) => ({ ...prev, [scenarioId]: result }));
  }

  return (
    <div className="feed-list">
      <p className="notice" role="status">
        Every exercise below is synthetic. Nothing here reads or writes production — practise freely.
      </p>
      {TRAINING_SCENARIOS.map((scenario) => {
        const result = feedback[scenario.id];
        return (
          <article className="panel feed-post" key={scenario.id} data-task={scenario.task}>
            <div className="feed-post-head">
              <strong>{scenario.title}</strong>
              <span className="muted small">{scenario.task.replaceAll("_", " ")}</span>
            </div>
            <p className="muted">{scenario.brief}</p>
            <div className="button-row">
              {scenario.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="button"
                  onClick={() => choose(scenario.id, option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {result ? (
              <p className={result.correct ? "notice" : "notice"} role="status" data-correct={result.correct}>
                {result.correct ? "✓ " : "✕ "}
                {result.feedback}
              </p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
