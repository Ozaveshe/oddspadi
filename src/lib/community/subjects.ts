import { cleanExternalIdentifier } from "@/lib/security/inputValidation";

// Canonical discussion subjects: every contextual community module attaches to
// one of these, with the id conventions the rest of the product already uses
// (fixture = provider external id, competition = league slug,
// publication = publication id).
export const COMMUNITY_SUBJECT_TYPES = [
  "fixture",
  "competition",
  "team",
  "player",
  "publication",
  "season_outlook",
  "strategy",
  "product_feedback"
] as const;

export type CommunitySubjectType = (typeof COMMUNITY_SUBJECT_TYPES)[number];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9:_\-.]{0,119}$/i;

export function parseCommunitySubject(raw: {
  subjectType?: unknown;
  subjectId?: unknown;
}): { subject_type: CommunitySubjectType; subject_id: string } | null {
  const type = raw.subjectType;
  if (typeof type !== "string" || !(COMMUNITY_SUBJECT_TYPES as readonly string[]).includes(type)) return null;
  if (type === "fixture") {
    const fixtureId = cleanExternalIdentifier(raw.subjectId);
    return fixtureId ? { subject_type: "fixture", subject_id: fixtureId } : null;
  }
  const id = typeof raw.subjectId === "string" ? raw.subjectId.trim() : "";
  return SLUG_PATTERN.test(id) ? { subject_type: type as CommunitySubjectType, subject_id: id } : null;
}

/** Parses the `?subject=type:id` query-string convention. */
export function parseSubjectParam(raw: string | undefined): { subjectType: CommunitySubjectType; subjectId: string } | null {
  if (!raw) return null;
  const [type, ...rest] = raw.split(":");
  const parsed = parseCommunitySubject({ subjectType: type, subjectId: rest.join(":") });
  return parsed ? { subjectType: parsed.subject_type, subjectId: parsed.subject_id } : null;
}

export function subjectHref(subjectType: CommunitySubjectType, subjectId: string): string {
  return `/community?subject=${encodeURIComponent(`${subjectType}:${subjectId}`)}`;
}
