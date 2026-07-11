// Shared mark for the generated PWA icon routes (app/icon-*/route.tsx,
// app/apple-icon.tsx). Rendered via next/og's ImageResponse — no external
// image asset pipeline needed. `safe` shrinks the glyph for the maskable
// variant so it survives an OS applying a circular/rounded-square mask
// (maskable.app's ~80%-diameter safe zone).
export function brandIconMark(size: number, safe = false) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2b7ea7",
      }}
    >
      <span
        style={{
          fontSize: size * (safe ? 0.34 : 0.46),
          fontWeight: 800,
          color: "#ffffff",
          letterSpacing: -1,
        }}
      >
        FR
      </span>
    </div>
  );
}
