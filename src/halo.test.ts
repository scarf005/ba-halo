import { describe, expect, test } from "vitest"
import {
  DEFAULT_GLOW,
  type Halo,
  IDENTITY,
  matches,
  placement,
  project,
  projector,
  projectPoints,
  repose,
  ringTurn,
  rotate,
  toSvg,
} from "./halo"

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

describe("placement", () => {
  const apply = (m: number[], [x, y, z]: number[]) =>
    [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r])

  test("matches the point placement used for projection", () => {
    const t = {
      ...IDENTITY,
      rotateX: 30,
      rotateY: -50,
      rotateZ: 20,
      x: 1,
      y: -2,
      z: 0.5,
      scaleX: 2,
      scaleY: 0.5,
      skewX: 10,
    }
    const [x, y] = projectPoints([0.3, -0.7, 0.4], t)
    const placed = apply(placement(t), [0.3, -0.7, 0.4])
    expect(placed[0]).toBeCloseTo(x)
    expect(placed[1]).toBeCloseTo(-y)
  })

  test("uniform scale scales depth equally", () => {
    const [, , z] = apply(placement({ ...IDENTITY, scaleX: 2, scaleY: 2 }), [0, 0, 1])
    expect(z).toBeCloseTo(2)
  })

  test("depth turns into width when rotated edge-on", () =>
    close(projectPoints([0, 0, 1], { ...IDENTITY, rotateY: 90 }) as [number, number], [1, 0]))
})

describe("projectPoints", () => {
  test("drops vertices behind the camera plane", () => {
    const points = projectPoints([0, 0, 0, 0, 0, 9], { ...IDENTITY, perspective: 5 })
    expect(points).toEqual([0, -0])
  })
})

describe("repose", () => {
  const yaw90 = [0, 0, 1, 0, 1, 0, -1, 0, 0]

  test("composes the pose's turn after the current rotation", () => {
    const turned = repose(IDENTITY, { turn: yaw90, shift: [0, 0, 0] })
    expect(turned.rotateY).toBeCloseTo(90)
    close(projector(turned)(1, 0), [0, -0])
  })

  test("moves the origin along the halo's own scaled axes", () => {
    const moved = repose(
      { ...IDENTITY, rotateZ: 90, scaleX: 2, x: 1 },
      { turn: [1, 0, 0, 0, 1, 0, 0, 0, 1], shift: [1, 0, 0] },
    )
    expect([moved.x, moved.y, moved.z]).toEqual([expect.closeTo(1), expect.closeTo(2), expect.closeTo(0)])
    expect(moved.scaleX).toBe(2)
  })
})

describe("rotate", () => {
  const tilted = { ...IDENTITY, rotateX: 30, rotateY: -50, rotateZ: 20 }

  test("turning about the local Z axis spins the halo in its own plane", () => {
    const turned = { ...tilted, ...rotate(tilted, { axis: 2, deg: 90, frame: "local" }) }
    close(projector(turned)(1, 0), projector(tilted)(0, 1))
  })

  test("turning about the world Y axis matches a Y rotation of an upright halo", () =>
    close(
      projector({ ...IDENTITY, ...rotate(IDENTITY, { axis: 1, deg: 40, frame: "world" }) })(1, 0.5),
      projector({ ...IDENTITY, rotateY: 40 })(1, 0.5),
    ))

  test("keeps the orientation through gimbal lock", () => {
    const locked = { ...IDENTITY, rotateX: 25, rotateY: 80 }
    const turned = { ...locked, ...rotate(locked, { axis: 1, deg: 10, frame: "local" }) }
    expect(turned.rotateY).toBeCloseTo(90)
    close(projector(turned)(1, 0.5), projector({ ...IDENTITY, rotateX: 25, rotateY: 90 })(1, 0.5))
    close(projector(turned)(0.3, -1), projector({ ...IDENTITY, rotateX: 25, rotateY: 90 })(0.3, -1))
  })
})

describe("ringTurn", () => {
  test("dragging the face-on Z ring counterclockwise on screen turns it positively", () =>
    expect(ringTurn({ t: IDENTITY, axis: 2, radius: 1, grab: [1, 0], drag: [0, -0.1] })).toBeCloseTo(5.73, 1))

  test("dragging the front of the edge-on X ring down tilts the top toward the camera", () =>
    expect(
      ringTurn({ t: { ...IDENTITY, perspective: 8 }, axis: 0, radius: 1, grab: [0, 0], drag: [0, 0.1] }),
    ).toBeCloseTo(5.01, 1))

  test("dragging across a ring does not turn it", () =>
    expect(ringTurn({ t: IDENTITY, axis: 2, radius: 1, grab: [1, 0], drag: [0.2, 0] })).toBeCloseTo(0))
})

describe("project", () => {
  const wide = [[[-3, 0, 3, 0, 3, 1, -3, 1]]]

  test("drops rings entirely behind the camera", () =>
    expect(project(wide, { ...IDENTITY, perspective: 1, z: 2 })).toEqual([[]]))

  test("clips rings that cross the camera plane to finite points", () => {
    const [[ring]] = project(wide, { ...IDENTITY, perspective: 2, rotateY: 90 })
    expect(ring.length).toBeGreaterThanOrEqual(6)
    expect(ring.every((v) => Number.isFinite(v) && Math.abs(v) < 100)).toBe(true)
  })
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

  test("adds no filter without glow", () =>
    expect(
      toSvg({ polygons: square, color: "#000", size: 10, glow: { radius: 0, strength: 1, color: "#fff" } }),
    ).not.toContain("filter"))

  test("grows the trimmed box by three glow radii and filters the halo", () => {
    const svg = toSvg({ polygons: square, color: "#000", size: 40, glow: { radius: 0.5, strength: 2, color: "#0ff" } })
    expect(svg).toContain('width="40" height="32" viewBox="-1.5 -1.5 5 4"')
    expect(svg).toContain('stdDeviation="0.5"')
    expect(svg).toContain('flood-color="#0ff"')
    expect(svg).toContain('slope="2"')
    expect(svg).toContain('<g fill="#000" filter="url(#glow)">')
  })

  test("a raster image replaces the paths, gets the output size and keeps the glow", () => {
    const sizes: unknown[] = []
    const svg = toSvg({
      polygons: square,
      color: "#000",
      size: 100,
      glow: { radius: 0.5, strength: 1, color: "#fff" },
      image: (o) => {
        sizes.push([o.width, o.height, o.box])
        return "data:image/png;base64,AA"
      },
    })
    expect(sizes).toEqual([[100, 80, { x: -1.5, y: -1.5, width: 5, height: 4 }]])
    expect(svg).toContain(
      '<g fill="#000" filter="url(#glow)"><image href="data:image/png;base64,AA" x="-1.5" y="-1.5" width="5" height="4"/></g>',
    )
    expect(svg).not.toContain("<path")
  })

  test("default glow is visible", () => {
    expect(DEFAULT_GLOW.radius).toBeGreaterThan(0)
    expect(DEFAULT_GLOW.strength).toBeGreaterThan(0)
  })

  test("draws each polygon as its own even-odd path", () =>
    expect(toSvg({ polygons: [...square, ...square], color: "#000", size: 10 }).match(/<path /g)).toHaveLength(2))
})

describe("matches", () => {
  const halo: Halo = {
    key: "Shiroko Terror",
    color: "#fff",
    school: "Abydos",
    tags: ["Abydos", "アビドス", "아비도스", "Foreclosure Task Force", "対策委員会", "대책위원회"],
    names: {
      en: { name: "Shiroko*Terror", full: "Sunaookami Shiroko" },
      ja: { name: "シロコ＊テラー", full: "砂狼 シロコ" },
      ko: { name: "시로코*테러", full: "스나오오카미 시로코" },
    },
    polygons: [],
  }

  test.each(["시로코테러", "砂狼シロコ", "SHIROKO terror", "abydos", "아비도스", "대책위원회", ""])("finds %s", (q) =>
    expect(matches(halo, q)).toBe(true),
  )

  test("rejects other names", () => expect(matches(halo, "호시노")).toBe(false))
})
