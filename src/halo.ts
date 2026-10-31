export type Locale = "en" | "ja" | "ko"

export type Halo = {
  key: string
  color: string
  /** School id, a key of `HaloData.schools`. */
  school: string | null
  names: Record<Locale, { name: string; full: string }>
  /** School and club names in every locale, for search. */
  tags: string[]
  /** Polygons of rings; each ring is a flat [x, y, x, y, ...] list with y pointing up. */
  polygons: number[][][]
}

export type HaloData = { schools: Record<string, Record<Locale, string>>; halos: Halo[] }

export type Glow = { radius: number; strength: number; color: string }

export type Transform = {
  rotateX: number
  rotateY: number
  rotateZ: number
  x: number
  y: number
  z: number
  scaleX: number
  scaleY: number
  skewX: number
  skewY: number
  /** Camera distance from the origin; 0 is orthographic. */
  perspective: number
}

export const IDENTITY: Transform = {
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  x: 0,
  y: 0,
  z: 0,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  perspective: 0,
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Scale, skew, rotate Z/Y/X, then translate; returns a 3D point with y pointing up. */
const placer = (t: Transform) => {
  const [cx, sx, cy, sy, cz, sz] = [t.rotateX, t.rotateY, t.rotateZ].flatMap((a) => [
    Math.cos(rad(a)),
    Math.sin(rad(a)),
  ])
  const [kx, ky] = [Math.tan(rad(t.skewX)), Math.tan(rad(t.skewY))]
  return (px: number, py: number): [number, number, number] => {
    const [ax, ay] = [px * t.scaleX, py * t.scaleY]
    const [bx, by] = [ax + kx * ay, ay + ky * ax]
    const [rx, ry] = [bx * cz - by * sz, bx * sz + by * cz]
    const [ux, uz] = [rx * cy, -rx * sy]
    const [vy, vz] = [ry * cx - uz * sx, ry * sx + uz * cx]
    return [ux + t.x, vy + t.y, vz + t.z]
  }
}

/** Points must stay this far in front of the camera, which limits perspective magnification to perspective / NEAR. */
const NEAR = 0.05

const toScreen = (t: Transform, [x, y, z]: number[]): [number, number] => {
  const f = t.perspective > 0 ? t.perspective / (t.perspective - z) : 1
  return [x * f, -y * f]
}

/** Placed and projected point; returns screen points with y pointing down. */
export const projector = (t: Transform) => {
  const place = placer(t)
  return (px: number, py: number) => toScreen(t, place(px, py))
}

/** Sutherland-Hodgman clip of a closed ring against the plane z = limit, keeping the side toward -z. */
const clipNear = (ring: number[][], limit: number) => {
  const out: number[][] = []
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]
    const [pIn, qIn] = [p[2] <= limit, q[2] <= limit]
    if (pIn) out.push(p)
    if (pIn !== qIn) {
      const k = (limit - p[2]) / (q[2] - p[2])
      out.push(p.map((v, j) => v + (q[j] - v) * k))
    }
  })
  return out
}

export const project = (polygons: number[][][], t: Transform) => {
  const place = placer(t)
  return polygons.map((rings) =>
    rings.flatMap((ring) => {
      let points: number[][] = []
      for (let i = 0; i < ring.length; i += 2) points.push(place(ring[i], ring[i + 1]))
      if (t.perspective > 0) points = clipNear(points, t.perspective - NEAR)
      return points.length < 3 ? [] : [points.flatMap((p) => toScreen(t, p))]
    }),
  )
}

const num = (n: number) => String(Math.round(n * 1e4) / 1e4)

export const pathData = (rings: number[][]) =>
  rings
    .map((ring) => {
      const pts = []
      for (let i = 0; i < ring.length; i += 2) pts.push(`${num(ring[i])} ${num(ring[i + 1])}`)
      return `M${pts.join("L")}Z`
    })
    .join("")

export type Box = { x: number; y: number; width: number; height: number }

export const bounds = (polygons: number[][][]): Box => {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const ring of polygons.flat()) {
    for (let i = 0; i < ring.length; i += 2) {
      minX = Math.min(minX, ring[i])
      maxX = Math.max(maxX, ring[i])
      minY = Math.min(minY, ring[i + 1])
      maxY = Math.max(maxY, ring[i + 1])
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export const FRAME: Box = { x: -2.5, y: -2.5, width: 5, height: 5 }

const grow = (b: Box, by: number): Box => ({
  x: b.x - by,
  y: b.y - by,
  width: b.width + 2 * by,
  height: b.height + 2 * by,
})

/** Blurred copy of the halo's alpha, tinted with the glow color and amplified by `strength`, drawn under the halo. */
const glowFilter = (g: Glow, box: Box) =>
  `<filter id="glow" filterUnits="userSpaceOnUse" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}">` +
  `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(g.radius)}" result="blur"/>` +
  `<feFlood flood-color="${g.color}"/><feComposite in2="blur" operator="in"/>` +
  `<feComponentTransfer><feFuncA type="linear" slope="${num(g.strength)}"/></feComponentTransfer>` +
  '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>'

/**
 * Standalone SVG whose longest side is `size` pixels; `box` defaults to the projected halo's bounds, grown to fit the
 * glow.
 */
export const toSvg = (o: { polygons: number[][][]; color: string; size: number; box?: Box; glow?: Glow }) => {
  const glow = o.glow && o.glow.radius > 0 && o.glow.strength > 0 ? o.glow : undefined
  const box = o.box ?? grow(bounds(o.polygons), glow ? glow.radius * 3 : 0)
  const scale = o.size / Math.max(box.width, box.height)
  const [w, h] = [Math.max(1, Math.round(box.width * scale)), Math.max(1, Math.round(box.height * scale))]
  const paths = o.polygons.map((rings) => `<path fill-rule="evenodd" d="${pathData(rings)}"/>`).join("")
  const viewBox = [box.x, box.y, box.width, box.height].map(num).join(" ")
  const [defs, filter] = glow ? [`<defs>${glowFilter(glow, box)}</defs>`, ' filter="url(#glow)"'] : ["", ""]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${defs}<g fill="${o.color}"${filter}>${paths}</g></svg>`
}

const fold = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s*＊]/g, "")

export const matches = (halo: Halo, query: string) => {
  const q = fold(query)
  if (!q) return true
  const terms = [halo.key, ...halo.tags, ...Object.values(halo.names).flatMap((n) => [n.name, n.full])]
  return terms.some((term) => fold(term).includes(q))
}
