# BA Halo

Search Blue Archive halos by name, school, or club, filter them by school, rotate and move them in 3D, add a glow, and
copy or save them as SVG or transparent PNG.
Halos with a character model also have a textured 3D view. Load the model to pose the halo on the character.
The UI is in English, Japanese, and Korean.

3D halos export as an SVG that holds a PNG of the render, because the mesh textures have no vector form.

## Commands

1. `pnpm install`
2. Clone [BlueArchiveModels](https://github.com/lihaohong6/BlueArchiveModels) next to this repository, or set
   `MODELS_DIR` to its path.
3. `just data` downloads the halo outlines and student names and extracts the halo meshes into `public/data/`.
4. `just dev` starts the dev server.
5. `just build` writes the static site to `dist/`.

## Data

- Halo outlines and colors: [Halo Forge](https://github.com/dobrosketchkun/halo_forge) `halo/data/ba_halos.json`.
- 3D halos and character models: [BlueArchiveModels](https://github.com/lihaohong6/BlueArchiveModels). The site loads
  a character model from jsDelivr only when you select it.
- Student, boss, school, and club names in English, Japanese, and Korean: [SchaleDB](https://schaledb.com).
- NPC names and affiliations: [ba-data](https://github.com/electricgoat/ba-data) `Excel/ScenarioCharacterNameExcelTable.json`.
