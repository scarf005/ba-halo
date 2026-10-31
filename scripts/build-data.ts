// Joins halo outlines from Halo Forge with student names from SchaleDB into public/data/halos.json
import { mkdir, writeFile } from "node:fs/promises"
import wellknown from "wellknown"

const HALOS = "https://raw.githubusercontent.com/dobrosketchkun/halo_forge/main/halo/data/ba_halos.json"
const STUDENTS = (lang: string) => `https://schaledb.com/data/${lang}/students.min.json`
const LANGS = { en: "en", ja: "jp", ko: "kr" } as const

type Student = { Id: number; PathName: string; Name: string; FamilyName: string; PersonalName: string; School: string }

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

const round = (n: number) => Math.round(n * 1e4) / 1e4

const halos = await getJson<Record<string, { color: string; wkt: string }>>(HALOS)
const students = Object.fromEntries(
  await Promise.all(
    Object.entries(LANGS).map(async ([ui, db]) => [
      ui,
      Object.values(await getJson<Record<string, Student>>(STUDENTS(db))),
    ]),
  ),
) as Record<keyof typeof LANGS, Student[]>

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
const localized = (id: number, lang: keyof typeof LANGS) => students[lang].find((s) => s.Id === id)

const matchedIds = new Set<number>()
const entries = Object.entries(halos).map(([key, { color, wkt }]) => {
  const geo = wellknown.parse(wkt)
  if (geo?.type !== "Polygon" && geo?.type !== "MultiPolygon") throw new Error(`${key}: unsupported ${geo?.type}`)
  const polygons = (geo.type === "Polygon" ? [geo.coordinates] : geo.coordinates) as number[][][][]
  const student = byName.get(ALIASES[key] ?? key)
  if (student) matchedIds.add(student.Id)
  const names = Object.fromEntries(
    Object.keys(LANGS).map((lang) => {
      const s = student && localized(student.Id, lang as keyof typeof LANGS)
      return [
        lang,
        s
          ? {
              name: s.Name,
              full: [s.FamilyName, s.PersonalName]
                .map((n) => n.trim())
                .filter(Boolean)
                .join(" "),
            }
          : { name: key, full: key },
      ]
    }),
  )
  return {
    key,
    color,
    school: student?.School ?? null,
    names,
    // Each polygon is drawn with even-odd fill on its own, so its holes stay holes without merging other polygons.
    polygons: polygons.map((p) => p.map((ring) => ring.flatMap(([x, y]) => [round(x), round(y)]))),
  }
})

const unmatched = entries.filter((e) => !e.school).map((e) => e.key)
const haloless = [
  ...new Set(
    students.en
      .filter((s) => !matchedIds.has(byName.get(`${s.FamilyName} ${s.PersonalName}`)?.Id ?? -1))
      .map((s) => s.Name),
  ),
]
await mkdir("public/data", { recursive: true })
await writeFile("public/data/halos.json", JSON.stringify(entries))
console.log(`halos: ${entries.length}, without SchaleDB match: ${unmatched.length} (${unmatched.join(", ")})`)
console.log(`SchaleDB students without halo: ${haloless.length} (${haloless.join(", ")})`)
