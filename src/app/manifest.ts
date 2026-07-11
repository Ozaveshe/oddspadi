import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OddsPadi — Football Predictions & Live Scores",
    short_name: "OddsPadi",
    description:
      "Your football padi: AI predictions, real-time live scores, and honest value analysis for matches across Africa and beyond.",
    start_url: "/",
    display: "standalone",
    background_color: "#0B1310",
    theme_color: "#0B1310",
    categories: ["sports", "news"],
    icons: [
      {
        src: "/brand/oddspadi-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png"
      }
    ]
  };
}
