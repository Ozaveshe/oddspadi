import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OddsPadi — Football Predictions & Live Scores",
    short_name: "OddsPadi",
    description:
      "Your football padi: AI predictions, real-time live scores, and honest value analysis for matches across Africa and beyond.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e0c",
    theme_color: "#0a0e0c",
    categories: ["sports", "news"],
    shortcuts: [
      { name: "Live scores", short_name: "Live", url: "/live-scores", description: "Today's live football and basketball scores" },
      { name: "Today's predictions", short_name: "Predictions", url: "/predictions", description: "Model probabilities, odds and value for today" },
      { name: "Padi feed", short_name: "Community", url: "/community", description: "Fan takes and matchday talk" }
    ],
    icons: [
      {
        src: "/brand/oddspadi-icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "any"
      },
      {
        src: "/brand/oddspadi-icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable"
      },
      { src: "/brand/oddspadi-icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/oddspadi-icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
