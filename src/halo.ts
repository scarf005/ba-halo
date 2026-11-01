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
  mesh?: HaloMesh
}

/** 3D halo extracted from a character model; `file` holds it in halo units, loaded only when shown. */
export type HaloMesh = {
  file: string
  /** Whether the 2D outline already shows this halo faithfully, so 2D is the default view. */
  flat: boolean
  /** The character's model, then its costumes that have a halo. */
  models: HaloModel[]
}

/** A model file; its halo mesh maps to halo units by `unit * (basis * (scale * vertex) - center)`. */
export type HaloModel = {
  file: string
  /** The halo node's rest scale, baked into the halo. */
  scale: number[]
  /** Row-major. */
  basis: number[]
  center: number[]
  unit: number
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

export const DEFAULT_GLOW = { radius: 0, strength: 1.5 }

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
const deg = (rad: number) => (rad * 180) / Math.PI

/** Row-major 3x3 matrix. */
type Mat3 = number[]
export type Axis = 0 | 1 | 2
type Rotation = Pick<Transform, "rotateX" | "rotateY" | "rotateZ">

const mul = (a: Mat3, b: Mat3) =>
  a.map((_, i) => {
    const [r, c] = [Math.floor(i / 3) * 3, i % 3]
    return a[r] * b[c] + a[r + 1] * b[3 + c] + a[r + 2] * b[6 + c]
  })

const UNIT = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** Rodrigues rotation about a unit axis. */
const axisAngle = ([x, y, z]: number[], degrees: number): Mat3 => {
  const [c, s] = [Math.cos(rad(degrees)), Math.sin(rad(degrees))]
  const k = 1 - c
  return [
    ...[c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    ...[y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    ...[z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ]
}

/** Rotation that applies Z, then Y, then X. */
const rotation = (t: Rotation) =>
  mul(mul(axisAngle(UNIT[0], t.rotateX), axisAngle(UNIT[1], t.rotateY)), axisAngle(UNIT[2], t.rotateZ))

/** Inverse of `rotation`; at gimbal lock (rotateY = ±90) it puts the whole roll into rotateX. */
const euler = (m: Mat3): Rotation => {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2])))
  if (Math.cos(y) < 1e-6) return { rotateX: deg(Math.atan2(Math.sign(m[2]) * m[3], m[4])), rotateY: deg(y), rotateZ: 0 }
  return { rotateX: deg(Math.atan2(-m[5], m[8])), rotateY: deg(y), rotateZ: deg(Math.atan2(-m[1], m[0])) }
}

/** Turns the halo about one of its own axes ("local") or one of the screen axes ("world"). */
export const rotate = (t: Rotation, o: { axis: Axis; deg: number; frame: "local" | "world" }) => {
  const [m, a] = [rotation(t), axisAngle(UNIT[o.axis], o.deg)]
  return euler(o.frame === "local" ? mul(m, a) : mul(a, m))
}

/** Scale, skew, rotate Z/Y/X, then translate; returns a 3D point with y pointing up. Depth scales by the mean scale. */
const placer = (t: Transform) => {
  const m = rotation(t)
  const [kx, ky] = [Math.tan(rad(t.skewX)), Math.tan(rad(t.skewY))]
  const scaleZ = Math.sqrt(Math.abs(t.scaleX * t.scaleY))
  return (px: number, py: number, pz = 0): [number, number, number] => {
    const [ax, ay, az] = [px * t.scaleX, py * t.scaleY, pz * scaleZ]
    const [bx, by] = [ax + kx * ay, ay + ky * ax]
    return [
      m[0] * bx + m[1] * by + m[2] * az + t.x,
      m[3] * bx + m[4] * by + m[5] * az + t.y,
      m[6] * bx + m[7] * by + m[8] * az + t.z,
    ]
  }
}

/** The placement as a column-major 4x4 matrix. */
export const placement = (t: Transform) => {
  const place = placer(t)
  const columns = [place(1, 0, 0), place(0, 1, 0), place(0, 0, 1)].map(([x, y, z]) => [x - t.x, y - t.y, z - t.z, 0])
  return [...columns.flat(), t.x, t.y, t.z, 1]
}

/**
 * The transform after the halo moved by a rigid `turn` and `shift` within its own frame, as when the character wearing
 * it changes pose; `turn` is row-major. Scale and skew stay.
 */
export const repose = (t: Transform, o: { turn: Mat3; shift: number[] }): Transform => {
  const [x, y, z] = placer(t)(o.shift[0], o.shift[1], o.shift[2])
  return { ...t, ...euler(mul(rotation(t), o.turn)), x, y, z }
}

/** Euler angles of a row-major rotation matrix. */
export const anglesOf = euler

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

/** Screen points of 3D vertices, as one flat ring; vertices behind the camera plane are dropped. */
export const projectPoints = (vertices: ArrayLike<number>, t: Transform) => {
  const place = placer(t)
  const points: number[] = []
  for (let i = 0; i < vertices.length; i += 3) {
    const p = place(vertices[i], vertices[i + 1], vertices[i + 2])
    if (visible(t, p)) points.push(...toScreen(t, p))
  }
  return points
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

const RING_STEPS = 72

/** 3D points of the circle of `radius` around the halo origin, perpendicular to local `axis`, by increasing angle. */
const ringPoints = (t: Transform, axis: Axis, radius: number) => {
  const m = rotation(t)
  const [u, v] = [(axis + 1) % 3, (axis + 2) % 3]
  const origin = [t.x, t.y, t.z]
  return Array.from({ length: RING_STEPS }, (_, i) => {
    const a = (2 * Math.PI * i) / RING_STEPS
    const [cu, sv] = [Math.cos(a) * radius, Math.sin(a) * radius]
    return origin.map((o, r) => m[r * 3 + u] * cu + m[r * 3 + v] * sv + o)
  })
}

const visible = (t: Transform, p: number[]) => t.perspective <= 0 || p[2] <= t.perspective - NEAR

/** Screen path of a rotation ring, clipped at the camera plane. */
export const ringPath = (t: Transform, axis: Axis, radius: number) => {
  let points = ringPoints(t, axis, radius)
  if (t.perspective > 0) points = clipNear(points, t.perspective - NEAR)
  return points.length < 3 ? "" : pathData([points.flatMap((p) => toScreen(t, p))])
}

/**
 * Degrees to turn about local `axis` after a pointer grabbed its ring at screen point `grab` and moved by `drag`:
 * the drag along the ring's screen tangent at the grabbed point, so the grabbed point follows the pointer.
 */
export const ringTurn = (o: { t: Transform; axis: Axis; radius: number; grab: number[]; drag: number[] }) => {
  const points = ringPoints(o.t, o.axis, o.radius)
  const screen = points.map((p) => toScreen(o.t, p))
  // Where the front and back of an edge-on ring overlap, prefer the front, which is nearer the camera (larger z).
  const score = (i: number) =>
    visible(o.t, points[i])
      ? Math.hypot(screen[i][0] - o.grab[0], screen[i][1] - o.grab[1]) - 0.01 * points[i][2]
      : Infinity
  const i = screen.reduce((best, _, j) => (score(j) < score(best) ? j : best), 0)
  const n = RING_STEPS
  const [a, b] = [screen[(i + n - 1) % n], screen[(i + 1) % n]]
  const step = (4 * Math.PI) / n
  const tangent = [(b[0] - a[0]) / step, (b[1] - a[1]) / step]
  // Near the ends of an edge-on ring the tangent points at the camera; keep the turn per screen unit bounded there.
  const length2 = Math.max(tangent[0] ** 2 + tangent[1] ** 2, (0.2 * o.radius) ** 2)
  return deg((o.drag[0] * tangent[0] + o.drag[1] * tangent[1]) / length2)
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
export const glowFilter = (g: Glow, box: Box, id = "glow") =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}">` +
  `<feGaussianBlur in="SourceAlpha" stdDeviation="${num(g.radius)}" result="blur"/>` +
  `<feFlood flood-color="${g.color}"/><feComposite in2="blur" operator="in"/>` +
  `<feComponentTransfer><feFuncA type="linear" slope="${num(g.strength)}"/></feComponentTransfer>` +
  '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>'

/**
 * Standalone SVG whose longest side is `size` pixels; `box` defaults to the projected halo's bounds, grown to fit the
 * glow. `image` replaces the paths with a raster of the box at the output size, for textured 3D halos.
 */
export const toSvg = (o: {
  polygons: number[][][]
  color: string
  size: number
  box?: Box
  glow?: Glow
  image?: (o: { box: Box; width: number; height: number }) => string
}) => {
  const glow = o.glow && o.glow.radius > 0 && o.glow.strength > 0 ? o.glow : undefined
  const box = o.box ?? grow(bounds(o.polygons), glow ? glow.radius * 3 : 0)
  const scale = o.size / Math.max(box.width, box.height)
  const [w, h] = [Math.max(1, Math.round(box.width * scale)), Math.max(1, Math.round(box.height * scale))]
  const viewBox = [box.x, box.y, box.width, box.height].map(num).join(" ")
  const paths = o.image
    ? `<image href="${o.image({ box, width: w, height: h })}" x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}"/>`
    : o.polygons.map((rings) => `<path fill-rule="evenodd" d="${pathData(rings)}"/>`).join("")
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
