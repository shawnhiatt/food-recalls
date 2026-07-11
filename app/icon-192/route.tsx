import { ImageResponse } from "next/og";
import { brandIconMark } from "@/lib/brand-icon";

export const runtime = "edge";

export function GET() {
  const size = 192;
  return new ImageResponse(brandIconMark(size), { width: size, height: size });
}
