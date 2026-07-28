import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` pins the app's identity independently of `start_url`. Without it a
    // later change to `start_url` registers as a *different* app and installed
    // users silently stop receiving updates.
    id: "/",
    name: "OddsPadi — Football Predictions & Live Scores",
    short_name: "OddsPadi",
    description:
      "Your football padi: AI predictions, real-time live scores, and honest value analysis for matches across Africa and beyond.",
    start_url: "/",
    scope: "/",
    lang: "en",
    dir: "ltr",
    display: "standalone",
    orientation: "portrait-primary",
    // The site renders on a white surface (`--bg: #ffffff`). These were near
    // black, so the installed app flashed a black splash and then painted a
    // black title bar over a white page, disagreeing with the `themeColor` the
    // root layout sends to browsers.
    background_color: "#ffffff",
    theme_color: "#ffffff",
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
