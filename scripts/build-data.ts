// Joins halo outlines from Halo Forge with student, boss, school and club names from SchaleDB and NPC names from the
// game's scenario name table into public/data/halos.json
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Document, MathUtils, NodeIO } from "@gltf-transform/core"
import wellknown from "wellknown"
import { fitHalo } from "./fit-halo.ts"

const MODELS = process.env.MODELS_DIR ?? "../BlueArchiveModels"
// Halo Forge spellings that differ from the model file names.
const MODEL_NAMES: Record<string, string> = {
  Alice: "Arisu",
  Miku: "Hatsune Miku",
  "Shiroko Terror": "Shiroko＊Terror",
}
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
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
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

// A halo is flat when it is thin and its face-on silhouette resembles the outline. Outlines of tilted 3D halos such as
// Noa's show an oblique view, which overlaps the face-on mesh poorly.
const [MAX_FLAT_DEPTH, MIN_FLAT_OVERLAP] = [0.15, 0.3]
const io = new NodeIO()
const modelFiles = (await readdir(MODELS)).filter((f) => f.endsWith(".glb")).sort()

// Fits a model's halo mesh to the outline. The halo node's own scale, which can be nonuniform or mirrored, is baked into
// the vertices, so what remains between halo units and the model is a rotation, a shift and one uniform unit.
const fitModel = async (file: string, polygons: number[][][]) => {
  const model = (await io.read(join(MODELS, file))).getRoot()
  const mesh = model.listMeshes().find((m) => /halo/i.test(m.getName()))
  const node = model.listNodes().find((n) => n.getMesh() === mesh)
  if (!mesh || !node || node.getSkin()) return

  const [first] = mesh.listPrimitives()
  const positions = first.getAttribute("POSITION")
  if (!positions || mesh.listPrimitives().some((p) => p.getAttribute("POSITION") !== positions)) {
    throw new Error(`${file}: halo primitives do not share one vertex list`)
  }
  const scale: [number, number, number] = [1, 1, 1]
  MathUtils.decompose(node.getWorldMatrix(), [0, 0, 0], [0, 0, 0, 1], scale)
  const scaled = (source: ArrayLike<number>) => Float32Array.from(source, (v, i) => v * scale[i % 3])
  const vertices = scaled(positions.getArray() ?? [])
  const triangles = mesh.listPrimitives().flatMap((p) => [...(p.getIndices()?.getArray() ?? [])])
  const fit = fitHalo({ vertices, triangles, polygons })
  return {
    mesh,
    fit,
    vertices,
    entry: {
      file,
      scale: scale.map(round6),
      basis: fit.basis.map(round6),
      center: fit.center.map(round6),
      unit: round6(fit.unit),
    },
  }
}

// Bakes the base model's halo mesh into its own GLB, turned, scaled and centered to overlay the Halo Forge outline.
const extractMesh = async (key: string, polygons: number[][][]) => {
  const base = MODEL_NAMES[key] ?? key
  if (!modelFiles.includes(`${base}.glb`)) return
  const fitted = await fitModel(`${base}.glb`, polygons)
  if (!fitted) return
  const { mesh, fit, vertices } = fitted
  const { basis, center, unit } = fit

  const costumes = []
  for (const file of modelFiles.filter((f) => f.startsWith(`${base} (`))) {
    const costume = await fitModel(file, polygons)
    if (costume) costumes.push(costume.entry)
  }

  const out = new Document()
  const buffer = out.createBuffer()
  const haloMesh = out.createMesh("halo")
  out.createScene().addChild(out.createNode("halo").setMesh(haloMesh))
  const accessor = (type: "VEC2" | "VEC3" | "SCALAR", array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) =>
    out.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  for (const p of mesh.listPrimitives()) {
    const positions = Float32Array.from(vertices, (_, i) => {
      const [row, v] = [(i % 3) * 3, i - (i % 3)]
      const turned = basis[row] * vertices[v] + basis[row + 1] * vertices[v + 1] + basis[row + 2] * vertices[v + 2]
      return (turned - center[i % 3]) * unit
    })
    const primitive = out.createPrimitive().setAttribute("POSITION", accessor("VEC3", positions))
    const uv = p.getAttribute("TEXCOORD_0")?.getArray()
    if (uv) primitive.setAttribute("TEXCOORD_0", accessor("VEC2", Float32Array.from(uv)))
    const indices = p.getIndices()?.getArray()
    if (indices) primitive.setIndices(accessor("SCALAR", Uint32Array.from(indices)))
    const material = out.createMaterial().setAlphaMode(p.getMaterial()?.getAlphaMode() ?? "OPAQUE")
    const texture = p.getMaterial()?.getBaseColorTexture()
    const image = texture?.getImage()
    if (image) {
      material.setBaseColorTexture(
        out
          .createTexture()
          .setImage(image)
          .setMimeType(texture?.getMimeType() || "image/png"),
      )
    }
    haloMesh.addPrimitive(primitive.setMaterial(material))
  }

  const slug = key.toLowerCase().replace(/\W+/g, "-")
  await mkdir("public/data/mesh", { recursive: true })
  await writeFile(`public/data/mesh/${slug}.glb`, await io.writeBinary(out))
  return {
    file: `data/mesh/${slug}.glb`,
    flat: fit.depth < MAX_FLAT_DEPTH && fit.overlap >= MIN_FLAT_OVERLAP,
    models: [fitted.entry, ...costumes],
  }
}

const withMeshes = []
for (const entry of entries) withMeshes.push({ ...entry, mesh: await extractMesh(entry.key, entry.polygons) })

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
await writeFile("public/data/halos.json", JSON.stringify({ schools, halos: withMeshes }))
console.log(`halos: ${entries.length}, English only: ${unnamed.length} (${unnamed.map((e) => e.key).join(", ")})`)
console.log(`SchaleDB students without halo: ${haloless.length} (${haloless.join(", ")})`)
const noMesh = withMeshes.filter((e) => !e.mesh).map((e) => e.key)
console.log(`meshes: ${withMeshes.length - noMesh.length}, without: ${noMesh.length} (${noMesh.join(", ")})`)
console.log(`not flat: ${withMeshes.flatMap((e) => (e.mesh?.flat === false ? [e.key] : [])).join(", ")}`)
