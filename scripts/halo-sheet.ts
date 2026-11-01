// Writes .screenshots/sheet/sheet.svg: each extracted halo mesh in white with its Halo Forge outline in red on top, to
// check the fit by eye. Pass halo keys to limit the sheet.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { NodeIO } from "@gltf-transform/core"
import { pathData } from "../src/halo.ts"

type Entry = { key: string; polygons: number[][][]; mesh?: { file: string; flat: boolean } }

const [CELL, COLUMNS] = [220, 12]
const io = new NodeIO()
const { halos } = JSON.parse(await readFile("public/data/halos.json", "utf8")) as { halos: Entry[] }
const only = process.argv.slice(2)
const shown = halos.filter((h) => h.mesh && (!only.length || only.includes(h.key)))

const cells = await Promise.all(
  shown.map(async (h, i) => {
    const doc = await io.read(`public/data/${(h.mesh as { file: string }).file.replace("data/", "")}`)
    const faces = doc
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives())
      .map((p) => {
        const v = p.getAttribute("POSITION")?.getArray() ?? []
        const index = p.getIndices()?.getArray() ?? []
        const rings: number[][] = []
        for (let t = 0; t < index.length; t += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => [v[index[t + k] * 3], -v[index[t + k] * 3 + 1]])
          // Front and back faces wind opposite ways and would cancel under the nonzero fill.
          const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
          rings.push(area < 0 ? [...a, ...c, ...b] : [...a, ...b, ...c])
        }
        return pathData(rings)
      })
    const outline = h.polygons.map((rings) => pathData(rings.map((r) => r.map((n, j) => (j % 2 ? -n : n)))))
    const [x, y] = [(i % COLUMNS) * CELL, Math.floor(i / COLUMNS) * CELL]
    const label = `${h.key}${h.mesh?.flat ? "" : " (3D)"}`
    return (
      `<g transform="translate(${x + CELL / 2} ${y + CELL / 2}) scale(${CELL / 4.4})">` +
      `<path fill="#fff" fill-rule="nonzero" d="${faces.join("")}"/>` +
      `<path fill="none" stroke="#f33" stroke-width="0.025" d="${outline.join("")}"/></g>` +
      `<text x="${x + 4}" y="${y + 14}" fill="#ff0" font-size="12">${label}</text>`
    )
  }),
)

const rows = Math.ceil(shown.length / COLUMNS)
await mkdir(".screenshots/sheet", { recursive: true })
await writeFile(
  ".screenshots/sheet/sheet.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * CELL}" height="${rows * CELL}"><rect width="100%" height="100%" fill="#222"/>${cells.join("")}</svg>`,
)
