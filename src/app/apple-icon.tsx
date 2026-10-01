import { brandIcon } from "./brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners itself, so the home-screen icon is a full square.
export default function AppleIcon() {
  return brandIcon(180, false);
}
