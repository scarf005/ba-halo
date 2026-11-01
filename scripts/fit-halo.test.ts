import { describe, expect, test } from "vitest"
import { fitHalo } from "./fit-halo"

// An "L" of two rectangles in the z = 0 plane: it has no rotational or mirror symmetry except along its diagonal, so
// the top-heavy variant below pins the side and the turn.
const shape = [
  [0, 0, 3, 0, 3, 1, 0, 1],
  [0, 1, 1, 1, 1, 3, 0, 3],
  [0, 3, 0.5, 3, 0.5, 3.4, 0, 3.4],
]
const polygons = shape.map((ring) => [ring])

const mesh = (place: (x: number, y: number) => number[]) => {
  const vertices = shape.flatMap((r) => [0, 2, 4, 6].flatMap((i) => place(r[i], r[i + 1])))
  const triangles = shape.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map((v) => q * 4 + v))
  return { vertices, triangles, polygons }
}

const placed = (fit: ReturnType<typeof fitHalo>, [x, y, z]: number[]) =>
  [0, 1, 2].map(
    (r) => (fit.basis[r * 3] * x + fit.basis[r * 3 + 1] * y + fit.basis[r * 3 + 2] * z - fit.center[r]) * fit.unit,
  )

describe("fitHalo", () => {
  test("keeps a face-on mesh upright and overlays the outline", () => {
    const fit = fitHalo(mesh((x, y) => [x / 10, y / 10, 0]))
    expect(fit.overlap).toBeGreaterThan(0.95)
    expect(fit.depth).toBeCloseTo(0)
    const corner = placed(fit, [0.3, 0, 0])
    expect(corner[0]).toBeCloseTo(3)
    expect(corner[1]).toBeCloseTo(0)
  })

  test("recovers a flat mesh tilted out of its plane", () => {
    const [c, s] = [Math.cos(0.7), Math.sin(0.7)]
    const fit = fitHalo(mesh((x, y) => [x, y * c, y * s]))
    expect(fit.depth).toBeCloseTo(0)
    expect(fit.overlap).toBeGreaterThan(0.95)
  })

  test("views a mesh from the outline's side, not its mirror image", () => {
    const fit = fitHalo(mesh((x, y) => [-x, y, 0]))
    expect(fit.overlap).toBeGreaterThan(0.95)
    const corner = placed(fit, [-3, 0, 0])
    expect(corner[0]).toBeCloseTo(3)
  })

  test("reports a poor overlap when the outline is a different shape", () => {
    const fit = fitHalo({ ...mesh((x, y) => [x, y, 0]), polygons: [[[0, 0, 3.4, 0, 3.4, 0.2, 0, 0.2]]] })
    expect(fit.overlap).toBeLessThan(0.3)
  })
})
