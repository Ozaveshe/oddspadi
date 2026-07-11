type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type GeocodingResponse = {
  results?: Array<{
    latitude?: number;
    longitude?: number;
    name?: string;
    country?: string;
  }>;
};

type ForecastResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
    wind_speed_10m?: number[];
  };
};

export type OpenMeteoForecastObservation = {
  observedFor: string;
  temperatureC: number | null;
  precipitationMm: number;
  precipitationProbability: number | null;
  windKph: number | null;
  humidity: number | null;
  weatherCode: number | null;
  condition: string;
  impactScore: number;
  forecastDistanceMinutes: number;
  location: string;
  endpoint: string;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function at(values: number[] | undefined, index: number): number | null {
  return finite(values?.[index]);
}

function weatherCondition(code: number | null): string {
  if (code === null) return "forecast available";
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code >= 85 && code <= 86) return "snow showers";
  if (code >= 95) return "thunderstorm";
  return "mixed conditions";
}

function impactScore({
  precipitationMm,
  precipitationProbability,
  windKph,
  temperatureC,
  weatherCode
}: {
  precipitationMm: number;
  precipitationProbability: number | null;
  windKph: number | null;
  temperatureC: number | null;
  weatherCode: number | null;
}): number {
  const probability = precipitationProbability === null ? (precipitationMm > 0 ? 0.5 : 0) : precipitationProbability / 100;
  const severeCode = weatherCode !== null && (weatherCode >= 71 || weatherCode >= 95);
  const temperaturePenalty = temperatureC !== null && (temperatureC <= 0 || temperatureC >= 34) ? 0.03 : 0;
  const adverse = precipitationMm > 0 || probability >= 0.45 || (windKph ?? 0) >= 28 || severeCode || temperaturePenalty > 0;
  if (!adverse) return 0;
  return -Number(Math.min(0.22, 0.08 + probability * 0.08 + Math.max(0, (windKph ?? 0) - 28) * 0.002 + temperaturePenalty).toFixed(4));
}

async function fetchJson(fetchImpl: FetchLike, endpoint: URL): Promise<unknown | null> {
  try {
    const response = await fetchImpl(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  }
}

export async function fetchOpenMeteoForecast({
  city,
  kickoffAt,
  fetchImpl = fetch
}: {
  city: string;
  kickoffAt: string;
  fetchImpl?: FetchLike;
}): Promise<OpenMeteoForecastObservation | null> {
  const normalizedCity = city.trim();
  const kickoffMs = Date.parse(kickoffAt);
  if (!normalizedCity || !Number.isFinite(kickoffMs)) return null;

  const geocodingEndpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingEndpoint.searchParams.set("name", normalizedCity);
  geocodingEndpoint.searchParams.set("count", "1");
  geocodingEndpoint.searchParams.set("language", "en");
  geocodingEndpoint.searchParams.set("format", "json");
  const geocoding = (await fetchJson(fetchImpl, geocodingEndpoint)) as GeocodingResponse | null;
  const location = geocoding?.results?.find((item) => finite(item.latitude) !== null && finite(item.longitude) !== null);
  if (!location || location.latitude === undefined || location.longitude === undefined) return null;

  const forecastEndpoint = new URL("https://api.open-meteo.com/v1/forecast");
  forecastEndpoint.searchParams.set("latitude", String(location.latitude));
  forecastEndpoint.searchParams.set("longitude", String(location.longitude));
  forecastEndpoint.searchParams.set(
    "hourly",
    "temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m"
  );
  forecastEndpoint.searchParams.set("timezone", "UTC");
  forecastEndpoint.searchParams.set("forecast_days", "16");
  const forecast = (await fetchJson(fetchImpl, forecastEndpoint)) as ForecastResponse | null;
  const times = forecast?.hourly?.time ?? [];
  const closest = times
    .map((time, index) => ({ time, index, timestamp: Date.parse(`${time}Z`) }))
    .filter((item) => Number.isFinite(item.timestamp))
    .map((item) => ({ ...item, distance: Math.abs(item.timestamp - kickoffMs) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!closest || closest.distance > 4 * 60 * 60 * 1000) return null;

  const temperatureC = at(forecast?.hourly?.temperature_2m, closest.index);
  const precipitationMm = at(forecast?.hourly?.precipitation, closest.index) ?? 0;
  const precipitationProbability = at(forecast?.hourly?.precipitation_probability, closest.index);
  const windKph = at(forecast?.hourly?.wind_speed_10m, closest.index);
  const humidity = at(forecast?.hourly?.relative_humidity_2m, closest.index);
  const weatherCode = at(forecast?.hourly?.weather_code, closest.index);
  return {
    observedFor: new Date(closest.timestamp).toISOString(),
    temperatureC,
    precipitationMm,
    precipitationProbability,
    windKph,
    humidity,
    weatherCode,
    condition: weatherCondition(weatherCode),
    impactScore: impactScore({ precipitationMm, precipitationProbability, windKph, temperatureC, weatherCode }),
    forecastDistanceMinutes: Math.round(closest.distance / 60_000),
    location: [location.name, location.country].filter(Boolean).join(", ") || normalizedCity,
    endpoint: forecastEndpoint.toString()
  };
}
