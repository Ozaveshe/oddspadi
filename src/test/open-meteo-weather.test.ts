import { describe, expect, it, vi } from "vitest";
import { fetchOpenMeteoForecast } from "@/lib/sports/providers/openMeteo";

describe("Open-Meteo football weather fallback", () => {
  it("geocodes a venue city and selects the hourly forecast nearest kickoff without a key", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "geocoding-api.open-meteo.com") {
        expect(url.searchParams.get("name")).toBe("London");
        return Response.json({ results: [{ latitude: 51.5072, longitude: -0.1276, name: "London", country: "United Kingdom" }] });
      }
      expect(url.hostname).toBe("api.open-meteo.com");
      expect(url.searchParams.get("hourly")).toContain("precipitation_probability");
      return Response.json({
        hourly: {
          time: ["2026-07-10T18:00", "2026-07-10T19:00", "2026-07-10T20:00"],
          temperature_2m: [21, 20, 19],
          relative_humidity_2m: [70, 75, 79],
          precipitation_probability: [20, 70, 60],
          precipitation: [0, 1.4, 0.6],
          weather_code: [3, 61, 80],
          wind_speed_10m: [14, 31, 28]
        }
      });
    });

    const forecast = await fetchOpenMeteoForecast({
      city: "London",
      kickoffAt: "2026-07-10T19:10:00.000Z",
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(forecast).toEqual(
      expect.objectContaining({
        observedFor: "2026-07-10T19:00:00.000Z",
        temperatureC: 20,
        precipitationMm: 1.4,
        precipitationProbability: 70,
        windKph: 31,
        humidity: 75,
        condition: "rain",
        location: "London, United Kingdom"
      })
    );
    expect(forecast?.impactScore).toBeLessThan(0);
    expect(forecast?.endpoint).not.toContain("apikey");
  });

  it("returns no observation when kickoff is outside the returned forecast window", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ results: [{ latitude: 51.5, longitude: -0.1, name: "London" }] }))
      .mockResolvedValueOnce(
        Response.json({
          hourly: {
            time: ["2026-07-10T19:00"],
            temperature_2m: [20]
          }
        })
      );
    const forecast = await fetchOpenMeteoForecast({ city: "London", kickoffAt: "2026-08-21T19:00:00.000Z", fetchImpl });
    expect(forecast).toBeNull();
  });
});
