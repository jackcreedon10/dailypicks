import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pick 3",
    short_name: "Pick 3",
    description: "Pick 3 stocks before the bell. Watch them all day. Beat your friends.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#3b5bfd",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }],
  };
}
