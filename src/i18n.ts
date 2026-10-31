import { i18n } from "@lingui/core"
import type { Locale } from "./halo"

export const LOCALES: Record<Locale, string> = { en: "English", ja: "日本語", ko: "한국어" }

const STORAGE_KEY = "locale"

const stored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const isLocale = (l: string | null | undefined): l is Locale => !!l && l in LOCALES

export const initialLocale = (): Locale =>
  [stored(), ...navigator.languages.map((l) => l.split("-")[0])].find(isLocale) ?? "en"

export const activate = async (locale: Locale) => {
  const { messages } = await import(`./locales/${locale}/messages.po`)
  i18n.loadAndActivate({ locale, messages })
  document.documentElement.lang = locale
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {}
}

export { i18n }
