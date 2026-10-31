# Fetch halo and student data into public/data
data:
    pnpm data

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
