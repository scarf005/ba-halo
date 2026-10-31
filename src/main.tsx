import { I18nProvider } from "@lingui/solid"
import { render } from "solid-js/web"
import { App } from "./App"
import { activate, i18n, initialLocale } from "./i18n"
import "./style.css"

await activate(initialLocale())

render(
  () => (
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  ),
  document.getElementById("root") as HTMLElement,
)
