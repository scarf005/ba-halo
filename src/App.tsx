import { useLingui } from "@lingui/solid/macro"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  bounds,
  FRAME,
  type Halo,
  IDENTITY,
  type Locale,
  matches,
  pathData,
  project,
  type Transform,
  toSvg,
} from "./halo"
import { activate, LOCALES } from "./i18n"

/** Full name, plus the costume name when the halo belongs to a costume such as Shiroko*Terror. */
const bare = (s: string) => s.replace(/\s/g, "")
const title = (n: { name: string; full: string }) =>
  bare(n.full).includes(bare(n.name)) ? n.full : `${n.name} (${n.full})`

const loadHalos = async (): Promise<Halo[]> => (await fetch("./data/halos.json")).json()

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

export const App = () => {
  const { t, i18n } = useLingui()
  const locale = () => i18n().locale as Locale
  const [halos] = createResource(loadHalos)
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<Halo>()
  const [transform, setTransform] = createStore<Transform>({ ...IDENTITY, perspective: 8 })
  const [color, setColor] = createSignal<string>()
  const [size, setSize] = createSignal(1024)
  const [trim, setTrim] = createSignal(true)
  const [status, setStatus] = createSignal("")

  const filtered = createMemo(() => (halos() ?? []).filter((h) => matches(h, query())))
  const current = () => selected() ?? filtered()[0]
  const fill = () => color() ?? current()?.color ?? "#000"
  const projected = createMemo(() => {
    const halo = current()
    return halo ? project(halo.polygons, { ...transform }) : []
  })
  const svg = () => toSvg({ polygons: projected(), color: fill(), size: size(), box: trim() ? undefined : FRAME })
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
  const downloadPng = () => svgToPng(svg()).then((b) => download(b, `${fileName()}.png`))

  let drag: { x: number; y: number } | undefined
  const endDrag = () => {
    drag = undefined
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return
    setTransform({
      rotateY: transform.rotateY + (e.clientX - drag.x) / 2,
      rotateX: transform.rotateX - (e.clientY - drag.y) / 2,
    })
    drag = { x: e.clientX, y: e.clientY }
  }

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
              <svg
                class="preview"
                viewBox={`${FRAME.x} ${FRAME.y} ${FRAME.width} ${FRAME.height}`}
                fill={fill()}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag = { x: e.clientX, y: e.clientY }
                }}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                role="img"
                aria-label={halo().names[locale()].full}
              >
                <For each={projected()}>{(rings) => <path fill-rule="evenodd" d={pathData(rings)} />}</For>
              </svg>
            </>
          )}
        </Show>
      </main>
      <section class="controls">
        <For each={sliders()}>
          {(s) => (
            <label class="slider">
              <span>{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={transform[s.key]}
                onInput={(e) => setTransform(s.key, e.currentTarget.valueAsNumber)}
              />
              <input
                type="number"
                aria-label={s.label}
                step={s.step}
                value={Math.round(transform[s.key] * 100) / 100}
                onChange={(e) => setTransform(s.key, e.currentTarget.valueAsNumber || 0)}
              />
            </label>
          )}
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
        <label class="slider">
          <span>{t`Size (px)`}</span>
          <input
            type="number"
            min={16}
            max={8192}
            value={size()}
            onChange={(e) => setSize(Math.min(8192, Math.max(16, e.currentTarget.valueAsNumber || 1024)))}
          />
        </label>
        <label class="check">
          <input type="checkbox" checked={trim()} onChange={(e) => setTrim(e.currentTarget.checked)} />
          <span>{t`Trim to halo`}</span>
        </label>
        <div class="actions">
          <button type="button" onClick={copySvg}>{t`Copy SVG`}</button>
          <button type="button" onClick={copyPng}>{t`Copy PNG`}</button>
          <button type="button" onClick={downloadSvg}>{t`Download SVG`}</button>
          <button type="button" onClick={downloadPng}>{t`Download PNG`}</button>
        </div>
        <output aria-live="polite">{status()}</output>
      </section>
    </div>
  )
}
