import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#f4efe6",
        ink: "#221b17",
        ember: "#9d3c23",
        emberSoft: "#d98d68"
      },
      fontFamily: {
        display: ["Georgia", "Times New Roman", "serif"],
        body: ["Georgia", "Times New Roman", "serif"]
      },
      boxShadow: {
        panel: "0 24px 60px rgba(44, 22, 10, 0.08)"
      },
      borderRadius: {
        panel: "24px"
      }
    }
  },
  plugins: []
};

export default config;

