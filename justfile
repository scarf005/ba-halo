# Fetch halo and student data into public/data
data:
    pnpm data

# Check extracted 3D halos against their outlines in .screenshots/sheet/sheet.svg
sheet:
    node scripts/halo-sheet.ts

# Dev server
dev:
    pnpm dev

# Production build in dist/
build:
    pnpm build

# Update .po catalogs from source
extract:
    pnpm extract

# Lint, format check, types, tests
check:
    pnpm check
    pnpm test

# Install the pre-commit hook
hooks:
    prek install
