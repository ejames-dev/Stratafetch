import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 43102,
    proxy: {
      "/v1": "http://localhost:43100",
      "/readyz": "http://localhost:43100",
      "/metrics": "http://localhost:43100",
    },
  },
});
