import { ImageResponse } from "next/og";
import { brandIconMark } from "@/lib/brand-icon";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const runtime = "edge";

export default function Icon() {
  return new ImageResponse(brandIconMark(32), size);
}
