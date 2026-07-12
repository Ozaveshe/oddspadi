import type { Match, Sport } from "@/lib/sports/types";
import { sports, uniqueCountries, uniqueLeagues } from "@/lib/sports/service";

export function DateSelector({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="field">
      <label htmlFor="date">Date</label>
      <input id="date" name="date" type="date" defaultValue={defaultValue} />
    </div>
  );
}

export function SportFilter({ selected = "football" }: { selected?: Sport }) {
  return (
    <div className="field">
      <label htmlFor="sport">Sport</label>
      <select
        id="sport"
        name="sport"
        defaultValue={selected}
        data-analytics-event="sport_selected"
        data-analytics-source="prediction_filters"
      >
        {sports.map((sport) => (
          <option key={sport.id} value={sport.id} disabled={!sport.active}>
            {sport.label}
            {!sport.active ? " - coming soon" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LeagueFilter({ matches, selected }: { matches: Match[]; selected?: string }) {
  return (
    <div className="field">
      <label htmlFor="league">League</label>
      <select id="league" name="league" defaultValue={selected ?? ""}>
        <option value="">All leagues</option>
        {uniqueLeagues(matches).map((league) => (
          <option key={league} value={league}>
            {league}
          </option>
        ))}
      </select>
    </div>
  );
}

export function CountryFilter({ matches, selected }: { matches: Match[]; selected?: string }) {
  return (
    <div className="field">
      <label htmlFor="country">Country</label>
      <select id="country" name="country" defaultValue={selected ?? ""}>
        <option value="">All countries</option>
        {uniqueCountries(matches).map((country) => (
          <option key={country} value={country}>
            {country}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ConfidenceFilter({ selected }: { selected?: string }) {
  return (
    <div className="field">
      <label htmlFor="confidence">Confidence</label>
      <select id="confidence" name="confidence" defaultValue={selected ?? ""}>
        <option value="">All confidence</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
    </div>
  );
}

export function SearchBox({ defaultValue }: { defaultValue?: string }) {
  return (
    <div className="field">
      <label htmlFor="q">Search</label>
      <input
        id="q"
        name="q"
        type="search"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Team or league…"
        defaultValue={defaultValue ?? ""}
      />
    </div>
  );
}
