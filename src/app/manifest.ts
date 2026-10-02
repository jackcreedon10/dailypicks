import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tickr Guesser",
    short_name: "Tickr",
    description: "Guess the mystery S&P 500 company from its stock chart. A new one every day.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#3b5bfd",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
