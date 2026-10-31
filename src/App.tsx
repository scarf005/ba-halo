import { useLingui } from "@lingui/solid/macro"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  type Axis,
  bounds,
  FRAME,
  type Glow,
  type Halo,
  type HaloData,
  IDENTITY,
  type Locale,
  matches,
  pathData,
  project,
  ringPath,
  ringTurn,
  rotate,
  type Transform,
  toSvg,
} from "./halo"
import { activate, LOCALES } from "./i18n"

/** Full name, plus the costume name when the halo belongs to a costume such as Shiroko*Terror. */
const bare = (s: string) => s.replace(/\s/g, "")
const title = (n: { name: string; full: string }) =>
  bare(n.full).includes(bare(n.name)) ? n.full : `${n.name} (${n.full})`

const loadData = async (): Promise<HaloData> => (await fetch("./data/halos.json")).json()

const download = (blob: Blob, name: string) => {
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  // Revoking right after click() cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const svgToPng = (svg: string) =>
  new Promise<Blob>((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext("2d")?.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))))
    }
    img.onerror = reject
    img.src = url
  })

const Thumb = (props: { halo: Halo }) => {
  const polygons = project(props.halo.polygons, IDENTITY)
  const box = bounds(polygons)
  const pad = Math.max(box.width, box.height) * 0.05
  return (
    <svg
      viewBox={`${box.x - pad} ${box.y - pad} ${box.width + 2 * pad} ${box.height + 2 * pad}`}
      fill={props.halo.color}
      aria-hidden="true"
    >
      <For each={polygons}>{(rings) => <path fill-rule="evenodd" d={pathData(rings)} />}</For>
    </svg>
  )
}

const Slider = (props: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onInput: (value: number) => void
}) => (
  <label class="slider">
    <span>{props.label}</span>
    <input
      type="range"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      onInput={(e) => props.onInput(e.currentTarget.valueAsNumber)}
    />
    <input
      type="number"
      aria-label={props.label}
      step={props.step}
      value={Math.round(props.value * 100) / 100}
      onChange={(e) => props.onInput(e.currentTarget.valueAsNumber || 0)}
    />
  </label>
)

export const App = () => {
  const { t, i18n } = useLingui()
  const locale = () => i18n().locale as Locale
  const [data] = createResource(loadData)
  const [query, setQuery] = createSignal("")
  /** undefined shows every halo; null shows halos without a school. */
  const [school, setSchool] = createSignal<string | null>()
  const [selected, setSelected] = createSignal<Halo>()
  const [transform, setTransform] = createStore<Transform>({ ...IDENTITY, perspective: 8 })
  const [color, setColor] = createSignal<string>()
  const [glow, setGlow] = createStore<Omit<Glow, "color"> & { color?: string }>({ radius: 0, strength: 1.5 })
  const [size, setSize] = createSignal(1024)
  const [trim, setTrim] = createSignal(true)
  const [status, setStatus] = createSignal("")

  const filtered = createMemo(() =>
    (data()?.halos ?? []).filter((h) => (school() === undefined || h.school === school()) && matches(h, query())),
  )
  const current = () => selected() ?? filtered()[0]
  const fill = () => color() ?? current()?.color ?? "#000"
  const projected = createMemo(() => {
    const halo = current()
    return halo ? project(halo.polygons, { ...transform }) : []
  })
  const glowSpec = (): Glow => ({ ...glow, color: glow.color ?? fill() })
  const svg = () =>
    toSvg({ polygons: projected(), color: fill(), size: size(), box: trim() ? undefined : FRAME, glow: glowSpec() })
  const fileName = () => `halo-${current()?.key.toLowerCase().replace(/\W+/g, "-")}`

  const flash = (message: string) => {
    setStatus(message)
    setTimeout(() => setStatus(""), 1500)
  }
  const copy = (write: () => Promise<void>) =>
    write().then(
      () => flash(t`Copied`),
      () => flash(t`Copy failed`),
    )
  const copySvg = () => copy(() => navigator.clipboard.writeText(svg()))
  const copyPng = () => copy(() => navigator.clipboard.write([new ClipboardItem({ "image/png": svgToPng(svg()) })]))
  const downloadSvg = () => download(new Blob([svg()], { type: "image/svg+xml" }), `${fileName()}.svg`)
  const downloadPng = () =>
    svgToPng(svg()).then(
      (b) => download(b, `${fileName()}.png`),
      () => flash(t`Save failed`),
    )
  /** Nothing to export before data loads, or when scaling or clipping leaves no area. */
  const exportable = () => {
    const box = bounds(projected())
    return Number.isFinite(box.width) && Math.max(box.width, box.height) > 0
  }

  /** Rotation rings sit just outside the halo, around its pivot. */
  const ringRadius = createMemo(() => {
    let r = 0
    for (const ring of current()?.polygons.flat() ?? []) {
      for (let i = 0; i < ring.length; i += 2) r = Math.max(r, Math.hypot(ring[i], ring[i + 1]))
    }
    return (r || 1) * 1.15
  })
  const AXES: Axis[] = [0, 1, 2]
  let gizmo!: SVGSVGElement
  const toFrame = (e: PointerEvent) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(gizmo.getScreenCTM()?.inverse())
    return [p.x, p.y]
  }

  /** Dragging a ring turns the halo about that local axis; dragging elsewhere turns it about the screen axes. */
  let drag: { x: number; y: number } | { axis: Axis; grab: number[]; start: Transform } | undefined
  const endDrag = () => {
    drag = undefined
  }
  const onPointerDown = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const axis = (e.target as Element).closest("[data-axis]")?.getAttribute("data-axis")
    drag = axis
      ? { axis: Number(axis) as Axis, grab: toFrame(e), start: { ...transform } }
      : { x: e.clientX, y: e.clientY }
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return
    if ("axis" in drag) {
      const [x, y] = toFrame(e)
      const { axis, grab, start } = drag
      const deg = ringTurn({ t: start, axis, radius: ringRadius(), grab, drag: [x - grab[0], y - grab[1]] })
      setTransform(rotate(start, { axis, deg, frame: "local" }))
      return
    }
    const yawed = rotate(transform, { axis: 1, deg: (e.clientX - drag.x) / 2, frame: "world" })
    setTransform(rotate(yawed, { axis: 0, deg: (e.clientY - drag.y) / 2, frame: "world" }))
    drag = { x: e.clientX, y: e.clientY }
  }

  const schoolChip = (id: string | null | undefined, label: string) => (
    <button type="button" aria-pressed={school() === id} onClick={() => setSchool(id)}>
      {label}
    </button>
  )

  const sliders = (): { key: keyof Transform; label: string; min: number; max: number; step: number }[] => [
    { key: "rotateX", label: t`Rotate X`, min: -180, max: 180, step: 1 },
    { key: "rotateY", label: t`Rotate Y`, min: -180, max: 180, step: 1 },
    { key: "rotateZ", label: t`Rotate Z`, min: -180, max: 180, step: 1 },
    { key: "x", label: t`Position X`, min: -2.5, max: 2.5, step: 0.01 },
    { key: "y", label: t`Position Y`, min: -2.5, max: 2.5, step: 0.01 },
    { key: "z", label: t`Position Z`, min: -5, max: 5, step: 0.01 },
    { key: "scaleX", label: t`Scale X`, min: -3, max: 3, step: 0.01 },
    { key: "scaleY", label: t`Scale Y`, min: -3, max: 3, step: 0.01 },
    { key: "skewX", label: t`Skew X`, min: -80, max: 80, step: 1 },
    { key: "skewY", label: t`Skew Y`, min: -80, max: 80, step: 1 },
    { key: "perspective", label: t`Perspective`, min: 0, max: 20, step: 0.1 },
  ]

  return (
    <div class="app">
      <aside class="browser">
        <div class="search-row">
          <input
            type="search"
            placeholder={t`Search`}
            aria-label={t`Search`}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <select aria-label={t`Language`} value={locale()} onChange={(e) => activate(e.currentTarget.value as Locale)}>
            <For each={Object.entries(LOCALES)}>{([code, name]) => <option value={code}>{name}</option>}</For>
          </select>
        </div>
        <div class="schools">
          {schoolChip(undefined, t`All`)}
          <For each={Object.entries(data()?.schools ?? {})}>{([id, names]) => schoolChip(id, names[locale()])}</For>
          {schoolChip(null, t`No school`)}
        </div>
        <ul class="halo-list">
          <For each={filtered()}>
            {(halo) => (
              <li>
                <button
                  type="button"
                  aria-pressed={current() === halo}
                  title={halo.names[locale()].full}
                  onClick={() => {
                    setSelected(halo)
                    setColor()
                  }}
                >
                  <Thumb halo={halo} />
                  <span>{halo.names[locale()].name}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </aside>
      <main class="editor">
        <Show when={current()}>
          {(halo) => (
            <>
              <h1>{title(halo().names[locale()])}</h1>
              <div
                class="preview"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                role="img"
                aria-label={halo().names[locale()].full}
              >
                <div
                  class="art"
                  innerHTML={toSvg({ polygons: projected(), color: fill(), size: 1000, box: FRAME, glow: glowSpec() })}
                />
                <svg
                  ref={gizmo}
                  class="gizmo"
                  viewBox={[FRAME.x, FRAME.y, FRAME.width, FRAME.height].join(" ")}
                  aria-hidden="true"
                >
                  <For each={AXES}>
                    {(axis) => {
                      const d = createMemo(() => ringPath({ ...transform }, axis, ringRadius()))
                      return (
                        <g data-axis={axis}>
                          <path d={d()} />
                          <path class="ring-hit" d={d()} />
                        </g>
                      )
                    }}
                  </For>
                </svg>
              </div>
            </>
          )}
        </Show>
      </main>
      <section class="controls">
        <For each={sliders()}>
          {(s) => <Slider {...s} value={transform[s.key]} onInput={(v) => setTransform(s.key, v)} />}
        </For>
        <button
          type="button"
          onClick={() => setTransform({ ...IDENTITY, perspective: 8 })}
        >{t`Reset transform`}</button>
        <label class="slider">
          <span>{t`Color`}</span>
          <input type="color" value={fill()} onInput={(e) => setColor(e.currentTarget.value)} />
          <button type="button" onClick={() => setColor()}>{t`Reset color`}</button>
        </label>
        <Slider
          label={t`Glow radius`}
          min={0}
          max={0.5}
          step={0.01}
          value={glow.radius}
          onInput={(v) => setGlow("radius", v)}
        />
        <Slider
          label={t`Glow strength`}
          min={0}
          max={5}
          step={0.1}
          value={glow.strength}
          onInput={(v) => setGlow("strength", v)}
        />
        <label class="slider">
          <span>{t`Glow color`}</span>
          <input type="color" value={glowSpec().color} onInput={(e) => setGlow("color", e.currentTarget.value)} />
          <button type="button" onClick={() => setGlow("color", undefined)}>{t`Reset color`}</button>
        </label>
        <label class="slider">
          <span>{t`Size (px)`}</span>
          <input
            type="number"
            min={16}
            max={8192}
            value={size()}
            onChange={(e) => {
              setSize(Math.min(8192, Math.max(16, e.currentTarget.valueAsNumber || 1024)))
              e.currentTarget.value = String(size())
            }}
          />
        </label>
        <label class="check">
          <input type="checkbox" checked={trim()} onChange={(e) => setTrim(e.currentTarget.checked)} />
          <span>{t`Trim to halo`}</span>
        </label>
        <div class="actions">
          <button type="button" disabled={!exportable()} onClick={copySvg}>{t`Copy SVG`}</button>
          <button type="button" disabled={!exportable()} onClick={copyPng}>{t`Copy PNG`}</button>
          <button type="button" disabled={!exportable()} onClick={downloadSvg}>{t`Download SVG`}</button>
          <button type="button" disabled={!exportable()} onClick={downloadPng}>{t`Download PNG`}</button>
        </div>
        <output aria-live="polite">{status()}</output>
      </section>
    </div>
  )
}
