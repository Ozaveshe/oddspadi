# Sports asset catalogue

OddsPadi exposes the team and league artwork already captured in `op_teams` and
`op_leagues` through one read-only endpoint:

```text
GET /api/sports/assets
```

The endpoint returns remote HTTPS references rather than copying third-party
logo files into the repository. Every item includes its provider and an
explicit `identification-only` usage label.

## Calls

```text
# First 50 football team crests
/api/sports/assets?sport=football

# All API-Football leagues, 100 at a time
/api/sports/assets?kind=league&sport=football&provider=api-football&limit=100&page=1
/api/sports/assets?kind=league&sport=football&provider=api-football&limit=100&page=2

# One provider identity
/api/sports/assets?kind=team&sport=football&provider=api-football&externalId=api-football%3A33

# Search and provider/external-ID filters are deliberately not CDN-cached
/api/sports/assets?kind=team&sport=football&q=Arsenal

# Include identity rows that do not yet have artwork
/api/sports/assets?sport=basketball&hasLogo=false
```

Supported filters are `kind`, `sport`, `provider`, `externalId`, `q`, `page`,
`limit`, and `hasLogo`. The default is `kind=team`, `page=1`, `limit=50`, and
`hasLogo=true`. A page can contain at most 100 assets.

## Rendering

Use `logoUrl` with `TeamCrest`, which already falls back to initials if an image
is absent or fails. League rows may also include `flagUrl`. Do not depend on a
provider URL being permanent; retain the fallback and refresh identity metadata
through the existing provider-enrichment lane.

## Rights and provenance

Club, national-team, and competition marks are normally protected trademarks.
Provider access or a publicly reachable image URL does not make a logo public
domain or grant merchandising rights. OddsPadi therefore keeps these assets as
provider-attributed remote references for factual identification in fixtures,
tables, and prediction pages. Any advertising, sponsorship, merchandise, or
standalone logo pack needs a separate rights review.
