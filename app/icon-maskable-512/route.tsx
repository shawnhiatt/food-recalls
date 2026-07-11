import { ImageResponse } from "next/og";
import { brandIconMark } from "@/lib/brand-icon";

export const runtime = "edge";

export function GET() {
  const size = 512;
  return new ImageResponse(brandIconMark(size, true), { width: size, height: size });
}
