import { brandIcon } from "./brand-icon";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return brandIcon(512, true);
}
