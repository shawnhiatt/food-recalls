import { ImageResponse } from "next/og";
import { brandIconMark } from "@/lib/brand-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
export const runtime = "edge";

export default function AppleIcon() {
  return new ImageResponse(brandIconMark(180), size);
}
