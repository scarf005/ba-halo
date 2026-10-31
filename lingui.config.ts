import { defineConfig } from "@lingui/solid/config"

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "ja", "ko"],
  catalogs: [{ path: "<rootDir>/src/locales/{locale}/messages", include: ["src"] }],
})
