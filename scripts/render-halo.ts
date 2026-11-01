// Software renderer for prerendered 3D halo thumbnails, so the build needs no GPU or browser.

export type Texture = { width: number; height: number; data: Uint8Array }
export type HaloPrimitive = {
  triangles: ArrayLike<number>
  uv?: ArrayLike<number>
  texture?: Texture
  color: number[]
  /** Whether the material uses the texture's alpha; the page ignores it on opaque materials. */
  cutout?: boolean
}

/** The camera looks down at the character's halo from this far above its level. */
const VIEW_TILT = (20 * Math.PI) / 180
/** A ring lying nearer edge-on than this, between its axis and the view, gets a higher camera so its shape shows. */
const MAX_AXIS_ANGLE = (60 * Math.PI) / 180
const PADDING = 0.05
/** Texels below this alpha are cut out, as one depth layer has no blending order to rely on. */
const MIN_ALPHA = 128

const multiply = (a: number[], b: number[]) =>
  [0, 3, 6].flatMap((r) => [0, 1, 2].map((c) => a[r] * b[c] + a[r + 1] * b[c + 3] + a[r + 2] * b[c + 6]))

/** Row-major turn from baked halo units to the view of the halo as the character wears it at rest. */
export const restView = (rest: number[], basis: number[]) => {
  const inverse = [basis[0], basis[3], basis[6], basis[1], basis[4], basis[7], basis[2], basis[5], basis[8]]
  const worn = multiply(rest, inverse)
  // Baked halos have their thin axis on z, and either end of that axis will do.
  const seen = Math.atan2(worn[5], worn[8]) - VIEW_TILT
  const axis = seen - Math.PI * Math.round(seen / Math.PI)
  const tilt = VIEW_TILT + axis - Math.max(-MAX_AXIS_ANGLE, Math.min(MAX_AXIS_ANGLE, axis))
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)]
  return multiply([1, 0, 0, 0, c, -s, 0, s, c], worn)
}

const wrap = (v: number) => v - Math.floor(v)

/** Draws opaque triangles with a depth buffer, framed to fill `size`, as RGBA rows from the top. */
export const renderHalo = (o: {
  vertices: ArrayLike<number>
  primitives: HaloPrimitive[]
  /** Row-major. */
  turn: number[]
  size: number
}) => {
  const { vertices, primitives, turn: m, size } = o
  const count = vertices.length / 3
  const points = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]]
    for (let row = 0; row < 3; row++) points[i * 3 + row] = m[row * 3] * x + m[row * 3 + 1] * y + m[row * 3 + 2] * z
  }
  const used = primitives.flatMap((p) => Array.from(p.triangles))
  const along = (axis: number) => used.map((i) => points[i * 3 + axis])
  const [xs, ys] = [along(0), along(1)]
  const [left, right, bottom, top] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const scale = (size * (1 - 2 * PADDING)) / Math.max(right - left, top - bottom)
  const toX = (x: number) => size / 2 + (x - (left + right) / 2) * scale
  const toY = (y: number) => size / 2 - (y - (bottom + top) / 2) * scale

  const image = new Uint8Array(size * size * 4)
  const depth = new Float64Array(size * size).fill(Number.NEGATIVE_INFINITY)
  for (const { triangles, uv, texture, color, cutout } of primitives) {
    for (let t = 0; t + 2 < triangles.length; t += 3) {
      const [a, b, c] = [triangles[t], triangles[t + 1], triangles[t + 2]]
      const [ax, ay, bx, by, cx, cy] = [
        toX(points[a * 3]),
        toY(points[a * 3 + 1]),
        toX(points[b * 3]),
        toY(points[b * 3 + 1]),
        toX(points[c * 3]),
        toY(points[c * 3 + 1]),
      ]
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
      if (area === 0) continue
      const [x0, x1] = [
        Math.max(0, Math.floor(Math.min(ax, bx, cx))),
        Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx))),
      ]
      const [y0, y1] = [
        Math.max(0, Math.floor(Math.min(ay, by, cy))),
        Math.min(size - 1, Math.ceil(Math.max(ay, by, cy))),
      ]
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const [px, py] = [x + 0.5, y + 0.5]
          const wb = ((px - ax) * (cy - ay) - (py - ay) * (cx - ax)) / area
          const wc = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area
          const wa = 1 - wb - wc
          if (wa < 0 || wb < 0 || wc < 0) continue
          const z = wa * points[a * 3 + 2] + wb * points[b * 3 + 2] + wc * points[c * 3 + 2]
          const cell = y * size + x
          if (z <= depth[cell]) continue
          let rgb: ArrayLike<number> = color
          if (uv && texture) {
            const u = wa * uv[a * 2] + wb * uv[b * 2] + wc * uv[c * 2]
            const v = wa * uv[a * 2 + 1] + wb * uv[b * 2 + 1] + wc * uv[c * 2 + 1]
            const row = Math.floor(wrap(v) * texture.height)
            const texel = (row * texture.width + Math.floor(wrap(u) * texture.width)) * 4
            if (cutout && texture.data[texel + 3] < MIN_ALPHA) continue
            rgb = texture.data.subarray(texel, texel + 3)
          }
          depth[cell] = z
          image.set([rgb[0], rgb[1], rgb[2], 255], cell * 4)
        }
      }
    }
  }
  return image
}
