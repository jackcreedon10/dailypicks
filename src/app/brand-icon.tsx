import { ImageResponse } from "next/og";

/** The Pick 3 app icon: a bold "3" over three bars in the stock colors. */
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
        <div style={{ fontSize: size * 0.56, fontWeight: 800, lineHeight: 1, marginTop: -size * 0.04 }}>3</div>
        <div style={{ display: "flex", gap: size * 0.04, marginTop: size * 0.05 }}>
          {["#ffffff", "#fbbf24", "#2dd4bf"].map((c) => (
            <div key={c} style={{ width: size * 0.16, height: bar, borderRadius: bar, background: c }} />
          ))}
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
