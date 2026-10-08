export default {
  poweredByHeader: false,
  devIndicators: false,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  outputFileTracingIncludes: {
    "/api/creator/upload": [
      "./node_modules/@ffprobe-installer/linux-x64/ffprobe",
    ],
  },
  serverExternalPackages: ["pg", "@ffprobe-installer/ffprobe"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};
