import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Echo Show devices ship a fixed-size Fire OS Silk browser viewport
// (1280x800 on 10"/15" hardware) — dev server just needs to be reachable
// on the LAN so the device can load it during development.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
