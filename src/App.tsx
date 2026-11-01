import { useLingui } from "@lingui/solid/macro"
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  type Axis,
  anglesOf,
  bounds,
  DEFAULT_GLOW,
  FRAME,
  type Glow,
  glowFilter,
  type Halo,
  type HaloData,
  IDENTITY,
  type Locale,
  matches,
  pathData,
  project,
  projectPoints,
  repose,
  ringPath,
  ringTurn,
  rotate,
  type Transform,
  toSvg,
} from "./halo"
import { activate, LOCALES } from "./i18n"
import type { createHaloView, createModelView } from "./scene"

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
  const [glow, setGlow] = createStore<Omit<Glow, "color"> & { color?: string }>({ ...DEFAULT_GLOW })
  const [size, setSize] = createSignal(1024)
  const [trim, setTrim] = createSignal(true)
  const [status, setStatus] = createSignal("")
  /** The user's choice of view for the current halo; undefined uses the halo's default. */
  const [view, setView] = createSignal<"2d" | "3d">()
  const [modelFile, setModelFile] = createSignal<string>()
  /** Index into the model's animations; names can repeat. */
  const [clip, setClip] = createSignal<number>()
  const [clipTime, setClipTime] = createSignal(0)
  const [stageSize, setStageSize] = createSignal(1000)

  const filtered = createMemo(() =>
    (data()?.halos ?? []).filter((h) => (school() === undefined || h.school === school()) && matches(h, query())),
  )
  const current = () => selected() ?? filtered()[0]
  const fill = () => color() ?? current()?.color ?? "#000"
  const heading = () => {
    const halo = current()
    return halo && title(halo.names[locale()])
  }

  let haloCanvas!: HTMLCanvasElement
  let modelCanvas!: HTMLCanvasElement
  let haloView: ReturnType<typeof createHaloView> | undefined
  let modelView: ReturnType<typeof createModelView> | undefined

  const wants3d = () => {
    const mesh = current()?.mesh
    return !!mesh && (view() ?? (mesh.flat ? "2d" : "3d")) === "3d"
  }
  /** Three.js and the mesh load only when a halo is first shown in 3D; 2D stays on screen until then. */
  const [vertices] = createResource(
    () => (wants3d() ? current()?.mesh?.file : undefined),
    async (file) => {
      const { createHaloView } = await import("./scene")
      haloView ??= createHaloView(haloCanvas)
      return haloView.load(`./${file}`)
    },
  )
  const shown3d = () => wants3d() && !vertices.loading && !vertices.error && !!vertices()
  /** The texture's own colors unless the user picked a color, which tints them; untextured halos use the fill. */
  const colors = () => ({ textured: color() ?? "#fff", plain: fill() })
  createEffect(() => {
    if (shown3d()) haloView?.draw({ ...transform }, colors())
  })

  const projected = createMemo(() => {
    const halo = current()
    if (!halo) return []
    return shown3d() ? [[projectPoints(vertices() ?? [], { ...transform })]] : project(halo.polygons, { ...transform })
  })
  const glowSpec = (): Glow => ({ ...glow, color: glow.color ?? fill() })
  const glowing = () => glow.radius > 0 && glow.strength > 0
  const svg = () =>
    toSvg({
      polygons: projected(),
      color: fill(),
      size: size(),
      box: trim() ? undefined : FRAME,
      glow: glowSpec(),
      image: shown3d() ? (o) => haloView?.capture({ ...o, t: { ...transform }, colors: colors() }) ?? "" : undefined,
    })
  /** The same glow on the live canvas, whose filter works in CSS pixels. */
  const canvasGlow = () => {
    const pixels = stageSize() / FRAME.width
    const box = { x: 0, y: 0, width: 1e4, height: 1e4 }
    return `<defs>${glowFilter({ ...glowSpec(), radius: glow.radius * pixels }, box, "canvas-glow")}</defs>`
  }

  const [model] = createResource(modelFile, async (file) => {
    const fit = current()?.mesh?.models.find((m) => m.file === file)
    if (!fit) return
    const { createModelView } = await import("./scene")
    modelView ??= createModelView(modelCanvas)
    const loaded = await modelView.load(fit)
    if (!loaded) return
    if (modelFile() !== file) {
      modelView.clear()
      return
    }
    const { animations, turn, scale, position } = loaded
    const [x, y, z] = position
    setClip()
    setClipTime(0)
    setTransform({ ...anglesOf(turn), scaleX: scale, scaleY: scale, x, y, z })
    return animations
  })
  const modelShown = () => !!modelFile() && !model.loading && !model.error && !!model()
  createEffect(() => {
    if (modelShown()) modelView?.draw({ ...transform })
    else modelView?.clear()
  })
  createEffect(() => {
    if (model.error || vertices.error) flash(t`Load failed`)
  })
  const clipDuration = () => model()?.[clip() ?? -1]?.duration ?? 0
  /** The body stays on screen while the halo follows the head to the new pose. */
  const setPose = (index: number | undefined, time: number) => {
    setClip(index)
    setClipTime(time)
    if (modelView) setTransform(repose({ ...transform }, modelView.pose(index, time)))
  }
  createEffect(
    on(current, () => {
      setView()
      setModelFile()
    }),
  )
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
  const observeStage = (stage: HTMLDivElement) => {
    const observer = new ResizeObserver(() => setStageSize(Math.min(stage.clientWidth, stage.clientHeight)))
    observer.observe(stage)
    onCleanup(() => observer.disconnect())
  }
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
        <h1>{heading()}</h1>
        {/* Stays mounted, because the WebGL views stay bound to its canvases. */}
        <div
          ref={observeStage}
          class="preview"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          role="img"
          aria-label={current()?.names[locale()].full}
        >
          <svg class="filters" aria-hidden="true" innerHTML={canvasGlow()} />
          <canvas ref={haloCanvas} hidden={!shown3d()} style={{ filter: glowing() ? "url(#canvas-glow)" : "none" }} />
          <Show when={current() && !shown3d()}>
            <div
              class="art"
              innerHTML={toSvg({
                polygons: projected(),
                color: fill(),
                size: 1000,
                box: FRAME,
                glow: glowSpec(),
              })}
            />
          </Show>
          <canvas ref={modelCanvas} hidden={!modelShown()} />
          <Show when={current()}>
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
          </Show>
        </div>
      </main>
      <section class="controls">
        <For each={sliders()}>
          {(s) => <Slider {...s} value={transform[s.key]} onInput={(v) => setTransform(s.key, v)} />}
        </For>
        <button
          type="button"
          onClick={() => setTransform({ ...IDENTITY, perspective: 8 })}
        >{t`Reset transform`}</button>
        <Show when={current()?.mesh}>
          {(mesh) => (
            <>
              <div class="actions">
                <button type="button" aria-pressed={!wants3d()} onClick={() => setView("2d")}>
                  2D
                </button>
                <button type="button" aria-pressed={wants3d()} onClick={() => setView("3d")}>
                  3D
                </button>
              </div>
              <label class="slider">
                <span>{t`Model`}</span>
                <select value={modelFile() ?? ""} onChange={(e) => setModelFile(e.currentTarget.value || undefined)}>
                  <option value="">{t`None`}</option>
                  <For each={mesh().models}>
                    {({ file }) => <option value={file}>{file.replace(/\.glb$/, "")}</option>}
                  </For>
                </select>
              </label>
              <Show when={modelShown()}>
                <label class="slider">
                  <span>{t`Pose`}</span>
                  <select
                    value={clip() ?? ""}
                    onChange={(e) => {
                      const { value } = e.currentTarget
                      setPose(value === "" ? undefined : Number(value), 0)
                    }}
                  >
                    <option value="">{t`Rest pose`}</option>
                    <For each={model()}>{(a, i) => <option value={i()}>{a.name}</option>}</For>
                  </select>
                </label>
                <Show when={clip() !== undefined}>
                  <Slider
                    label={t`Time (s)`}
                    min={0}
                    max={clipDuration()}
                    step={0.01}
                    value={clipTime()}
                    onInput={(v) => setPose(clip(), v)}
                  />
                </Show>
              </Show>
            </>
          )}
        </Show>
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
