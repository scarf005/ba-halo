import { describe, expect, test } from "vitest"
import { type Halo, IDENTITY, matches, project, projector, toSvg } from "./halo"

const close = ([x, y]: [number, number], [ex, ey]: [number, number]) => {
  expect(x).toBeCloseTo(ex)
  expect(y).toBeCloseTo(ey)
}

describe("projector", () => {
  test("identity keeps x and flips y to screen space", () => close(projector(IDENTITY)(1, 2), [1, -2]))

  test("rotating Y by 90 degrees turns the halo edge-on", () =>
    close(projector({ ...IDENTITY, rotateY: 90 })(1, 0.5), [0, -0.5]))

  test("scale and skew apply before rotation", () =>
    close(projector({ ...IDENTITY, scaleX: 2, skewX: 45, rotateZ: 90 })(1, 1), [-1, -3]))

  test("perspective enlarges points moved toward the camera", () => {
    const far = projector({ ...IDENTITY, perspective: 5 })(1, 0)
    const near = projector({ ...IDENTITY, perspective: 5, z: 2.5 })(1, 0)
    close(far, [1, 0])
    close(near, [2, 0])
  })

  test("orthographic mode ignores depth", () => close(projector({ ...IDENTITY, z: 3 })(1, 1), [1, -1]))
})

describe("toSvg", () => {
  const square = [[[0, 0, 2, 0, 2, 1, 0, 1]]]

  test("trims to the halo and sizes the longest side", () => {
    const svg = toSvg({ polygons: project(square, IDENTITY), color: "#f00", size: 100 })
    expect(svg).toContain('width="100" height="50" viewBox="0 -1 2 1"')
    expect(svg).toContain('<g fill="#f00"><path fill-rule="evenodd" d="M0 0L2 0L2 -1L0 -1Z"/></g>')
  })

  test("uses a given frame instead of the halo bounds", () =>
    expect(
      toSvg({ polygons: square, color: "#000", size: 10, box: { x: -5, y: -5, width: 10, height: 10 } }),
    ).toContain('width="10" height="10" viewBox="-5 -5 10 10"'))

  test("draws each polygon as its own even-odd path", () =>
    expect(toSvg({ polygons: [...square, ...square], color: "#000", size: 10 }).match(/<path /g)).toHaveLength(2))
})

describe("matches", () => {
  const halo: Halo = {
    key: "Shiroko Terror",
    color: "#fff",
    school: "Abydos",
    names: {
      en: { name: "Shiroko*Terror", full: "Sunaookami Shiroko" },
      ja: { name: "シロコ＊テラー", full: "砂狼 シロコ" },
      ko: { name: "시로코*테러", full: "스나오오카미 시로코" },
    },
    polygons: [],
  }

  test.each(["시로코테러", "砂狼シロコ", "SHIROKO terror", "abydos", ""])("finds %s", (q) =>
    expect(matches(halo, q)).toBe(true),
  )

  test("rejects other names", () => expect(matches(halo, "호시노")).toBe(false))
})
