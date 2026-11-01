import { EigenvalueDecomposition, Matrix } from "ml-matrix"

/** Row-major 3x3 matrix. */
type Mat3 = number[]

const GRID = 64

const apply = (m: Mat3, x: number, y: number, z: number) => [
  m[0] * x + m[1] * y + m[2] * z,
  m[3] * x + m[4] * y + m[5] * z,
  m[6] * x + m[7] * y + m[8] * z,
]

const mul = (a: Mat3, b: Mat3) =>
  a.map((_, i) => {
    const [r, c] = [Math.floor(i / 3) * 3, i % 3]
    return a[r] * b[c] + a[r + 1] * b[3 + c] + a[r + 2] * b[6 + c]
  })

/** Rodrigues rotation taking unit vector `n` to +z along the shortest arc. */
const toFront = ([x, y, z]: number[]): Mat3 => {
  if (z < -1 + 1e-9) return [1, 0, 0, 0, -1, 0, 0, 0, -1]
  const k = 1 / (1 + z)
  return [1 - x * x * k, -x * y * k, -x, -x * y * k, 1 - y * y * k, -y, x, y, z]
}

const TURNS: Mat3[] = Array.from({ length: 72 }, (_, i) => {
  const [c, s] = [Math.cos((i * Math.PI) / 36), Math.sin((i * Math.PI) / 36)]
  return [c, -s, 0, s, c, 0, 0, 0, 1]
})

/** Unit eigenvector of the vertex covariance with the least variance: the normal of the halo's plane. */
const thinAxis = (vertices: ArrayLike<number>) => {
  const n = vertices.length / 3
  const mean = [0, 0, 0]
  for (let i = 0; i < vertices.length; i++) mean[i % 3] += vertices[i] / n
  const cov = Matrix.zeros(3, 3)
  for (let v = 0; v < n; v++) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        cov.set(a, b, cov.get(a, b) + (vertices[v * 3 + a] - mean[a]) * (vertices[v * 3 + b] - mean[b]))
      }
    }
  }
  const eigen = new EigenvalueDecomposition(cov)
  const values = eigen.realEigenvalues
  return eigen.eigenvectorMatrix.getColumn(values.indexOf(Math.min(...values)))
}

/** Marks grid cells whose centers fall inside the outline; each polygon fills by even-odd and polygons union. */
const rasterOutline = (polygons: number[][][], cell: (i: number) => number[]) =>
  Array.from({ length: GRID * GRID }, (_, i) => {
    const [px, py] = cell(i)
    return polygons.some((rings) => {
      let inside = false
      for (const ring of rings) {
        for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
          const crosses = ring[a + 1] > py !== ring[b + 1] > py
          if (crosses && px < ((ring[b] - ring[a]) * (py - ring[a + 1])) / (ring[b + 1] - ring[a + 1]) + ring[a]) {
            inside = !inside
          }
        }
      }
      return inside
    })
  })

const span = (values: number[]) => [Math.min(...values), Math.max(...values)]

/**
 * Finds the rotation that shows the mesh face-on, from the same side as its 2D outline: tries both directions of the
 * plane normal with turns around it, and keeps the silhouette that overlaps the outline most. Ties go to the smallest
 * rotation, so symmetric halos stay upright.
 */
export const fitHalo = (o: { vertices: ArrayLike<number>; triangles: ArrayLike<number>; polygons: number[][][] }) => {
  const outline = o.polygons.flat(2)
  const [minX, maxX] = span(outline.filter((_, i) => i % 2 === 0))
  const [minY, maxY] = span(outline.filter((_, i) => i % 2 === 1))
  const size = Math.max(maxX - minX, maxY - minY)
  const [originX, originY] = [(minX + maxX) / 2 - size * 0.55, (minY + maxY) / 2 - size * 0.55]
  const step = (size * 1.1) / GRID
  const cell = (i: number) => [originX + ((i % GRID) + 0.5) * step, originY + (Math.floor(i / GRID) + 0.5) * step]
  const target = rasterOutline(o.polygons, cell)

  const n = o.vertices.length / 3
  const score = (basis: Mat3) => {
    const placed = Array.from({ length: n }, (_, v) =>
      apply(basis, o.vertices[v * 3], o.vertices[v * 3 + 1], o.vertices[v * 3 + 2]),
    )
    const [meshMinX, meshMaxX] = span(placed.map((p) => p[0]))
    const [meshMinY, meshMaxY] = span(placed.map((p) => p[1]))
    const [meshMinZ, meshMaxZ] = span(placed.map((p) => p[2]))
    const meshSize = Math.max(meshMaxX - meshMinX, meshMaxY - meshMinY)
    const unit = size / meshSize
    const center = [
      (meshMinX + meshMaxX) / 2 - (minX + maxX) / 2 / unit,
      (meshMinY + meshMaxY) / 2 - (minY + maxY) / 2 / unit,
      (meshMinZ + meshMaxZ) / 2,
    ]
    const cells = new Uint8Array(GRID * GRID)
    const screen = placed.map(([x, y]) => [(x - center[0]) * unit, (y - center[1]) * unit])
    for (let t = 0; t < o.triangles.length; t += 3) {
      const [a, b, c] = [screen[o.triangles[t]], screen[o.triangles[t + 1]], screen[o.triangles[t + 2]]]
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      if (area === 0) continue
      const [x0, x1] = span([a[0], b[0], c[0]]).map((v) => Math.floor((v - originX) / step))
      const [y0, y1] = span([a[1], b[1], c[1]]).map((v) => Math.floor((v - originY) / step))
      for (let cy = Math.max(0, y0); cy <= Math.min(GRID - 1, y1); cy++) {
        for (let cx = Math.max(0, x0); cx <= Math.min(GRID - 1, x1); cx++) {
          const [px, py] = cell(cy * GRID + cx)
          const u = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area
          const v = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area
          if (u >= 0 && v >= 0 && u + v <= 1) cells[cy * GRID + cx] = 1
        }
      }
    }
    let [both, either] = [0, 0]
    target.forEach((inside, i) => {
      if (inside && cells[i]) both++
      if (inside || cells[i]) either++
    })
    return {
      basis,
      center,
      unit,
      overlap: both / either,
      depth: (meshMaxZ - meshMinZ) / meshSize,
      // trace / 300 is at most 0.01, above rounding noise and below a real silhouette difference.
      rank: both / either + (basis[0] + basis[4] + basis[8]) / 300,
    }
  }

  const axis = thinAxis(o.vertices)
  return [axis, axis.map((v) => -v)]
    .flatMap((normal) => TURNS.map((turn) => score(mul(turn, toFront(normal)))))
    .reduce((best, c) => (c.rank > best.rank ? c : best))
}
