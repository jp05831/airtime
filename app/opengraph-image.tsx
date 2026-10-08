import { ImageResponse } from "next/og";
export const alt = "AIRTIME — Put Your Coin on TV";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "70px",
        background: "linear-gradient(130deg,#1644d8,#0fcce8,#c4e8fb)",
        color: "white",
        fontFamily: "Arial",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 28,
          fontWeight: 800,
          marginBottom: 42,
        }}
      >
        AIRTIME / CREATOR CAMPAIGN STUDIO
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 78,
          fontWeight: 800,
          lineHeight: 1.08,
        }}
      >
        Use creator fees to
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 85,
          fontStyle: "italic",
          fontFamily: "serif",
        }}
      >
        put your coin
      </div>
      <div style={{ display: "flex", fontSize: 78, fontWeight: 800 }}>
        on TV.
      </div>
      <div style={{ display: "flex", marginTop: 32, fontSize: 23 }}>
        $50 streaming-TV media + $10 AIRTIME fee
      </div>
    </div>,
    size,
  );
}
