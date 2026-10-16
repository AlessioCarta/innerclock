import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages under /<repo>/.
export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      // captcha.html: Turnstile bridge loaded by the native app (see src/api.js).
      input: { main: "index.html", captcha: "captcha.html" },
    },
  },
});
