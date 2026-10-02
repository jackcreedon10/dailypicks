import { ImageResponse } from "next/og";

/** The Daily Tickr app icon: a bold "T" over three guess tiles (right, close, miss). */
export function brandIcon(size: number, rounded: boolean) {
  const bar = Math.round(size * 0.09);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#3b5bfd",
          borderRadius: rounded ? size * 0.22 : 0,
          color: "white",
        }}
      >
        <div style={{ fontSize: size * 0.56, fontWeight: 800, lineHeight: 1, marginTop: -size * 0.04 }}>T</div>
        <div style={{ display: "flex", gap: size * 0.04, marginTop: size * 0.05 }}>
          {["#22c55e", "#fbbf24", "#e5e7eb"].map((c) => (
            <div key={c} style={{ width: size * 0.16, height: size * 0.16, borderRadius: bar / 2, background: c }} />
          ))}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
