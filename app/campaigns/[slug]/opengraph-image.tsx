import { ImageResponse } from "next/og";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "AIRTIME campaign placement proof";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        padding: 80,
        background: "linear-gradient(125deg,#1644d8,#0fcce8)",
        color: "white",
      }}
    >
      <div style={{ display: "flex", fontSize: 28 }}>
        AIRTIME / CAMPAIGN PROOF
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 82,
          fontWeight: 800,
          marginTop: 60,
        }}
      >
        Your coin.
      </div>
      <div style={{ display: "flex", fontSize: 82, fontStyle: "italic" }}>
        The big screen.
      </div>
      <div style={{ display: "flex", fontSize: 24, marginTop: 35 }}>
        Reviewed placements. Transparent reporting.
      </div>
    </div>,
    size,
  );
}
