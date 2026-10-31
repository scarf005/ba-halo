/// <reference types="vitest/config" />
import { lingui } from "@lingui/vite-plugin"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  base: "./",
  plugins: [solid({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }), lingui()],
  test: { environment: "node" },
})
