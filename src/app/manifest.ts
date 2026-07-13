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
