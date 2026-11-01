import { describe, expect, test } from "vitest"
import { renderHalo, restView } from "./render-halo.ts"

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const quad = (z: number) => [-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]
const TRIANGLES = [0, 1, 2, 0, 2, 3]
const pixel = (image: Uint8Array, size: number, [x, y]: number[]) => [
  ...image.slice((y * size + x) * 4, (y * size + x) * 4 + 4),
]
const RED = [255, 0, 0]
const BLUE = [0, 0, 255]

describe("renderHalo", () => {
  test("fills covered pixels and leaves the corners transparent around a triangle", () => {
    const image = renderHalo({
      vertices: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
      primitives: [{ triangles: [0, 1, 2], color: RED }],
      turn: IDENTITY,
      size: 32,
    })
    expect(pixel(image, 32, [16, 16])).toEqual([...RED, 255])
    expect(pixel(image, 32, [1, 1])).toEqual([0, 0, 0, 0])
  })

  test("the nearest surface wins whatever the drawing order", () => {
    const vertices = [...quad(1), ...quad(-1)]
    const front = { triangles: TRIANGLES, color: RED }
    const back = { triangles: TRIANGLES.map((i) => i + 4), color: BLUE }
    const render = (primitives: (typeof front)[]) => renderHalo({ vertices, primitives, turn: IDENTITY, size: 16 })
    expect(pixel(render([back, front]), 16, [8, 8])).toEqual([...RED, 255])
    expect(pixel(render([front, back]), 16, [8, 8])).toEqual([...RED, 255])
  })

  test("the top of the halo is on the top rows", () => {
    const image = renderHalo({
      vertices: [-1, -1, 0, 1, -1, 0, 0, 1, 0],
      primitives: [{ triangles: [0, 1, 2], color: RED }],
      turn: IDENTITY,
      size: 32,
    })
    expect(pixel(image, 32, [4, 28])[3]).toBe(255)
    expect(pixel(image, 32, [4, 3])[3]).toBe(0)
  })

  const checker = {
    width: 2,
    height: 1,
    data: Uint8Array.from([...RED, 255, ...BLUE, 0]),
  }
  const textured = {
    triangles: TRIANGLES,
    uv: [0, 0, 1, 0, 1, 0, 0, 0],
    texture: checker,
    color: [9, 9, 9],
    cutout: true,
  }

  test("samples the texture and cuts out its transparent parts", () => {
    const image = renderHalo({ vertices: quad(0), primitives: [textured], turn: IDENTITY, size: 32 })
    expect(pixel(image, 32, [4, 16])).toEqual([...RED, 255])
    expect(pixel(image, 32, [28, 16])).toEqual([0, 0, 0, 0])
  })

  test("an opaque material ignores the texture's alpha", () => {
    const image = renderHalo({
      vertices: quad(0),
      primitives: [{ ...textured, cutout: false }],
      turn: IDENTITY,
      size: 32,
    })
    expect(pixel(image, 32, [28, 16])).toEqual([...BLUE, 255])
  })

  test("wraps texture coordinates outside the image", () => {
    const uv = textured.uv.map((v, i) => (i % 2 === 0 ? v + 3 : v))
    const image = renderHalo({ vertices: quad(0), primitives: [{ ...textured, uv }], turn: IDENTITY, size: 32 })
    expect(pixel(image, 32, [4, 16])).toEqual([...RED, 255])
  })
})

describe("restView", () => {
  const apply = (m: number[], [x, y, z]: number[]) => [0, 3, 6].map((r) => m[r] * x + m[r + 1] * y + m[r + 2] * z)
  const yaw90 = [0, 0, 1, 0, 1, 0, -1, 0, 0]

  test("looks slightly from above, so the front of the halo drops on screen", () => {
    const [, y, z] = apply(restView(IDENTITY, IDENTITY), [0, 0, 1])
    expect(y).toBeLessThan(0)
    expect(z).toBeGreaterThan(0.9)
  })

  test.each([
    ["lying flat", [1, 0, 0, 0, 0, 1, 0, -1, 0]],
    ["lying flat upside down", [1, 0, 0, 0, 0, -1, 0, 1, 0]],
  ])("raises the camera over a ring %s so it opens instead of showing edge-on", (_, flat) =>
    expect(Math.abs(apply(restView(flat, IDENTITY), [0, 0, 1])[2])).toBeCloseTo(Math.cos(Math.PI / 3)),
  )

  test("undoes the fit's basis, restoring the orientation in the model", () => {
    const [x] = apply(restView(IDENTITY, yaw90), [0, 0, 1])
    const [ex] = apply(restView(IDENTITY, IDENTITY), [-1, 0, 0])
    expect(x).toBeCloseTo(ex)
  })
})
