export type FollowedTeam = {
  id: string;
  externalId: string;
  name: string;
  sport: string;
  country: string | null;
  logo: string | null;
};

export function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
