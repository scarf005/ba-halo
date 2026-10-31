// Joins halo outlines from Halo Forge with student, boss, school and club names from SchaleDB and NPC names from the
// game's scenario name table into public/data/halos.json
import { mkdir, writeFile } from "node:fs/promises"
import wellknown from "wellknown"

const HALOS = "https://raw.githubusercontent.com/dobrosketchkun/halo_forge/main/halo/data/ba_halos.json"
const SCENARIO_NAMES =
  "https://raw.githubusercontent.com/electricgoat/ba-data/global/Excel/ScenarioCharacterNameExcelTable.json"
const SCHALE = (lang: string, file: string) => `https://schaledb.com/data/${lang}/${file}.min.json`
const LANGS = { en: "en", ja: "jp", ko: "kr" } as const
type Lang = keyof typeof LANGS

type Student = {
  Id: number
  Name: string
  FamilyName: string
  PersonalName: string
  School: string
  Club: string
}
type Enemy = { Id: number; Name: string }
type Localization = { School: Record<string, string>; SchoolLong: Record<string, string>; Club: Record<string, string> }
type Names = { name: string; full: string }
/** `Nickname*` holds the NPC's affiliation, such as "General Student Council". */
type ScenarioName = Record<`${"Name" | "Nickname"}${"EN" | "JP" | "KR"}`, string>

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

const perLang = async <T>(load: (db: string) => Promise<T>) =>
  Object.fromEntries(await Promise.all(Object.entries(LANGS).map(async ([ui, db]) => [ui, await load(db)]))) as Record<
    Lang,
    T
  >

const round = (n: number) => Math.round(n * 1e4) / 1e4
const fullName = (s: Student) =>
  [s.FamilyName, s.PersonalName]
    .map((n) => n.trim())
    .filter(Boolean)
    .join(" ")

const halos = await getJson<Record<string, { color: string; wkt: string }>>(HALOS)
// Colors go into SVG markup unescaped.
for (const [key, { color }] of Object.entries(halos)) {
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) throw new Error(`${key}: invalid color ${color}`)
}
const students = await perLang(async (db) =>
  Object.values(await getJson<Record<string, Student>>(SCHALE(db, "students"))),
)
const enemies = await perLang(
  async (db) => (await getJson<{ Enemies: Record<string, Enemy> }>(SCHALE(db, "enemies"))).Enemies,
)
const localization = await perLang((db) => getJson<Localization>(SCHALE(db, "localization")))
const scenarioNames = (await getJson<{ DataList: ScenarioName[] }>(SCENARIO_NAMES)).DataList

// Halo Forge spellings that differ from SchaleDB names.
const ALIASES: Record<string, string> = { Alice: "Aris", "Shiroko Terror": "Shiroko*Terror" }

// Halo keys are personal names, full names for collab students, or the display name of a costume with its own halo.
// Other alternate costumes, named like "Airi (Band)", share the base student's halo.
const isCostume = (s: Student) => s.Name.includes("(")
const byName = new Map<string, Student>()
for (const s of [...students.en].sort((a, b) => Number(isCostume(a)) - Number(isCostume(b)) || a.Id - b.Id)) {
  for (const name of [`${s.FamilyName} ${s.PersonalName}`, s.PersonalName, s.Name]) {
    if (!byName.has(name)) byName.set(name, s)
  }
}

// Bosses appear under their own name, or with variant suffixes like "Kether Type V".
const enemyNames = (key: string): Record<Lang, Names> | undefined => {
  const all = Object.values(enemies.en)
  const enemy = all.find((e) => e.Name === key) ?? all.find((e) => e.Name.startsWith(`${key} Type`))
  if (!enemy) return
  return Object.fromEntries(
    Object.keys(LANGS).map((lang) => {
      const name = (enemies[lang as Lang][enemy.Id] ?? enemy).Name.replace(/ Type.*$/, "")
      return [lang, { name, full: name }]
    }),
  ) as Record<Lang, Names>
}

const SCENARIO_LANGS: Record<Lang, "EN" | "JP" | "KR"> = { en: "EN", ja: "JP", ko: "KR" }
const npc = (key: string) => scenarioNames.find((n) => n.NameEN === key && n.NameJP && n.NameKR)
const npcNames = (n: ScenarioName) =>
  Object.fromEntries(
    Object.entries(SCENARIO_LANGS).map(([lang, l]) => [lang, { name: n[`Name${l}`], full: n[`Name${l}`] }]),
  ) as Record<Lang, Names>

const matchedIds = new Set<number>()
const entries = Object.entries(halos).map(([key, { color, wkt }]) => {
  const geo = wellknown.parse(wkt)
  if (geo?.type !== "Polygon" && geo?.type !== "MultiPolygon") throw new Error(`${key}: unsupported ${geo?.type}`)
  const polygons = (geo.type === "Polygon" ? [geo.coordinates] : geo.coordinates) as number[][][][]
  const student = byName.get(ALIASES[key] ?? key)
  if (student) matchedIds.add(student.Id)
  const local = (lang: Lang) => student && students[lang].find((s) => s.Id === student.Id)
  const names =
    (student &&
      (Object.fromEntries(
        Object.keys(LANGS).map((lang) => {
          const s = local(lang as Lang) ?? student
          return [lang, { name: s.Name, full: fullName(s) }]
        }),
      ) as Record<Lang, Names>)) ??
    enemyNames(key) ??
    (npc(key) && npcNames(npc(key) as ScenarioName)) ??
    (Object.fromEntries(Object.keys(LANGS).map((lang) => [lang, { name: key, full: key }])) as Record<Lang, Names>)
  const tags = student
    ? Object.values(localization).flatMap((l) => [
        l.School[student.School],
        l.SchoolLong[student.School],
        l.Club[student.Club],
      ])
    : Object.values(SCENARIO_LANGS).map((l) => npc(key)?.[`Nickname${l}`])
  return {
    key,
    color,
    school: student?.School ?? null,
    names,
    tags: [...new Set(tags.filter(Boolean))],
    // Each polygon is drawn with even-odd fill on its own, so its holes stay holes without merging other polygons.
    polygons: polygons.map((p) => p.map((ring) => ring.flatMap(([x, y]) => [round(x), round(y)]))),
  }
})

const schools = Object.fromEntries(
  [...new Set(entries.flatMap((e) => (e.school ? [e.school] : [])))].map((id) => [
    id,
    Object.fromEntries(Object.entries(localization).map(([lang, l]) => [lang, l.School[id] ?? id])),
  ]),
)

const unnamed = entries.filter((e) => e.names.ja.name === e.key)
const haloless = [
  ...new Set(
    students.en
      .filter((s) => !matchedIds.has(byName.get(`${s.FamilyName} ${s.PersonalName}`)?.Id ?? -1))
      .map((s) => s.Name),
  ),
]
await mkdir("public/data", { recursive: true })
await writeFile("public/data/halos.json", JSON.stringify({ schools, halos: entries }))
console.log(`halos: ${entries.length}, English only: ${unnamed.length} (${unnamed.map((e) => e.key).join(", ")})`)
console.log(`SchaleDB students without halo: ${haloless.length} (${haloless.join(", ")})`)
