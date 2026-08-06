import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FixtureLifecycleBadge } from "@/components/odds/FixtureLifecycleBadge";
import { FIXTURE_STATUSES, isFixtureStatus } from "@/lib/domain/states";
import {
  LIFECYCLE_COPY,
  LIFECYCLE_TO_FIXTURE_STATUS,
  fixtureStatusFromLifecycle
} from "@/lib/sports/lifecycle/fixtureState";

const STATES = Object.keys(LIFECYCLE_COPY) as (keyof typeof LIFECYCLE_COPY)[];

/**
 * Two vocabularies exist on purpose — `FixtureStatus` is the provider's word,
 * `FixtureLifecycleState` is ours — and the risk of two is that they quietly
 * become synonyms maintained in two places. These pin the seam between them.
 */

describe("the derived vocabulary answers to the shared one", () => {
  it("maps every lifecycle state onto a real FixtureStatus", () => {
    for (const state of STATES) {
      const mapped = fixtureStatusFromLifecycle(state);
      expect(isFixtureStatus(mapped), `${state} maps to ${mapped}, which is not a FixtureStatus`).toBe(true);
      expect(FIXTURE_STATUSES).toContain(mapped);
    }
  });

  it("leaves no lifecycle state unmapped", () => {
    // A new state added to the union without a mapping is a compile error, but
    // only if the record is exhaustive — this catches a widened key type.
    expect(Object.keys(LIFECYCLE_TO_FIXTURE_STATUS).sort()).toEqual([...STATES].sort());
  });

  it("keeps the states we added distinct from the ones we already had", () => {
    // `due` and `unresolved` are refinements of `delayed` and `unknown`, which
    // the domain vocabulary always had but nothing could ever compute.
    expect(fixtureStatusFromLifecycle("due")).toBe("delayed");
    expect(fixtureStatusFromLifecycle("unresolved")).toBe("unknown");
  });
});

describe("every state has public copy", () => {
  it("gives each one a label and a detail", () => {
    for (const state of STATES) {
      expect(LIFECYCLE_COPY[state].label.length, `${state} has no label`).toBeGreaterThan(0);
      expect(LIFECYCLE_COPY[state].detail.length, `${state} has no detail`).toBeGreaterThan(0);
    }
  });

  it("never claims knowledge the state does not carry", () => {
    // The states that exist to admit ignorance must not read as conclusions.
    // The label is what most surfaces show on its own, so it carries the
    // strict rule: no outcome word at all.
    for (const state of ["due", "unresolved"] as const) {
      const label = LIFECYCLE_COPY[state].label.toLowerCase();
      for (const outcome of ["abandoned", "cancelled", "finished", "final", "complete"]) {
        expect(label, `${state} label claims "${outcome}"`).not.toContain(outcome);
      }
    }

    // The detail may reference an outcome, but only conditionally — "should
    // have finished" is an expectation, and saying so is the honest part.
    // What it must never do is assert one.
    for (const state of ["due", "unresolved"] as const) {
      const detail = LIFECYCLE_COPY[state].detail.toLowerCase();
      for (const assertion of ["has finished", "was abandoned", "was cancelled", "is final"]) {
        expect(detail, `${state} detail asserts "${assertion}"`).not.toContain(assertion);
      }
    }

    // And each must say plainly that we do not know.
    expect(LIFECYCLE_COPY.unresolved.detail.toLowerCase()).toContain("not received");
    expect(LIFECYCLE_COPY.due.detail.toLowerCase()).toContain("not had an update");
  });

  it("renders the label with the detail available to assistive tech", () => {
    const markup = renderToStaticMarkup(<FixtureLifecycleBadge state="unresolved" />);
    expect(markup).toContain("Result missing");
    expect(markup).toContain("We have not received a result");
    expect(markup).toContain('data-lifecycle-state="unresolved"');
  });

  it("renders every state without throwing", () => {
    for (const state of STATES) {
      const markup = renderToStaticMarkup(<FixtureLifecycleBadge state={state} showDetail />);
      expect(markup, `${state} rendered empty`).toContain(LIFECYCLE_COPY[state].label);
    }
  });
});
