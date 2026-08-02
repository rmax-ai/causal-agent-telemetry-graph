# TS Monorepo Patterns — pnpm Workspaces, TypeScript Project References, Biome

> Companion research doc for CATG (SPEC.md §20, §21). Applies to the pnpm/TypeScript monorepo
> with 20 packages + 3 apps. Library versions current as of Aug 2026: pnpm ≥10, TypeScript 5.x,
> Biome 2.x, Node.js 22+.
>
> Sources: pnpm.io/workspaces, biomejs.dev/guides/big-projects, TypeScript project-references docs,
> Next.js `transpilePackages` reference.

## 1. Workspace layout and `pnpm-workspace.yaml`

`pnpm-workspace.yaml` at the repo root declares which folders are workspace packages. CATG uses
`apps/*` (runtimes) and `packages/*` (libraries):

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"

# pnpm catalogs (pnpm 9.5+): one version source of truth per dependency.
catalog:
  typescript: ^5.7.0
  zod: ^4.2.0
  vitest: ^4.1.0
```

Catalogs let every package declare `"zod": "catalog:"` in its `package.json` — versions can no
longer drift across the 23 workspace projects. Run `pnpm add zod@catalog:` to opt in.

## 2. The `workspace:` protocol

Internal dependencies must use the `workspace:` protocol. `workspace:*` always resolves to the
local package; on `pnpm publish` it is rewritten to the concrete version (`workspace:^` → `^x.y.z`).

```jsonc
// packages/event-ledger/package.json
{
  "name": "@catg/event-ledger",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@catg/schema": "workspace:^",
    "better-sqlite3": "catalog:"
  },
  "scripts": { "build": "tsc -b", "test": "vitest run" }
}
```

Key points:

- **`exports` is the public contract** (AGENTS.md "Package Contracts"): consumers may only import
  what `exports` exposes. Everything else (helpers, internals) is private. `main`/`types` are
  legacy; prefer `exports` with the `types` condition **first** so TypeScript resolves declarations.
- **`"type": "module"`** per package; Node 22 runs ESM natively.
- Every `packages/*` entry has a single public entry (`src/index.ts`) compiled to `dist/`.
- `pnpm.overrides` in the **root** `package.json` pins transitive versions that must be unique —
  critical for React in a UI monorepo (see §6):

```jsonc
// package.json (root)
{
  "private": true,
  "pnpm": {
    "overrides": { "react": "19.1.0", "react-dom": "19.1.0" }
  }
}
```

## 3. `.npmrc` — hoisting for Next.js/Turbopack

pnpm's default is an *isolated* `node_modules` (symlinked virtual store). Next.js 16 + Turbopack
resolves modules by walking up `node_modules`; when two workspace packages pull different (even
semver-compatible) instances of the same dep, builds become nondeterministic. The surgical fix is
selective public hoisting, not `shamefully-hoist=true` (which destroys pnpm's strictness):

```ini
# .npmrc (repo root)
public-hoist-pattern[]=*react*
public-hoist-pattern[]=*react-dom*
public-hoist-pattern[]=*next*
public-hoist-pattern[]=@types/*
```

- `publicHoistPattern` hoists matching deps to the **root** `node_modules`; `hoistPattern`
  hoists only inside the hidden `.pnpm` store.
- Combine with `pnpm.overrides` (single React version) — that combination is the reliable 2026
  setup for Next.js monorepos. `node-linker=hoisted` (flat, npm-style tree) is the last-resort
  fallback when tooling cannot handle symlinks; `shamefully-hoist=true` should only be used as a
  diagnostic, then removed.

## 4. TypeScript: `tsconfig.base.json` + composite project references

Base config holds shared strictness; each package extends it and becomes a **composite** project
so `tsc -b` builds the dependency graph in order:

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

```jsonc
// packages/schema/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "composite": true },
  "include": ["src"],
  "references": [] // e.g. { "path": "../canonical-json" }
}
```

- **`composite: true` + `references`** enable incremental `tsc -b` builds: changing
  `packages/schema` rebuilds only `schema` and its dependents, in dependency order (fixes the
  alphabetical-build-order problem).
- **`declarationMap: true`** lets the editor jump to source of workspace deps even before `dist/`
  exists.
- The root `tsconfig.json` is a thin solution file (no `include`, `files: []`) so the IDE
  understands the whole graph:

```jsonc
// tsconfig.json (root)
{ "files": [], "references": [{ "path": "packages/schema" }, /* ... every package + app */] }
```

- Apps (Next.js, Fastify) may override `moduleResolution: "bundler"` / `jsx: "react-jsx"` and
  different `lib`, but keep `strict` inheritance.
- CI: `pnpm -r build` (each package runs `tsc -b`); `pnpm typecheck` runs `tsc -b --noEmit`-style
  checks via `pnpm -r typecheck` scripts.

## 5. Next.js monorepo: `transpilePackages`

Next.js compiles workspace packages automatically under the App Router (Turbopack + webpack).
`transpilePackages` is needed when a dependency **ships raw TypeScript/JSX or modern syntax**
(typically a `node_modules` package or an app consuming an unbuilt workspace package):

```ts
// apps/investigator-ui/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@catg/schema", "@catg/graph-model", "@catg/query-sdk"],
  output: "standalone",
};

export default nextConfig;
```

- Values are package names only (scoped names OK); paths/globs unsupported.
- A package cannot appear in both `transpilePackages` and `serverExternalPackages` (build error).
- Prefer building packages to plain JS (`tsc -b`) and pointing `exports` at `dist/` — then
  `transpilePackages` is only a fallback for packages that intentionally ship TS source.

## 6. Biome in a monorepo (v2+)

One root config + VCS-ignore integration covers most repos; nested configs use the `extends: "//"`
microsyntax which resolves the **root** config regardless of nesting (and implies `root: false`).

```jsonc
// biome.json (root)
{
  "$schema": "https://biomejs.dev/schemas/2.2.0/schema.json",
  "files": {
    "ignoreUnknown": true,
    "includes": [
      "**",
      "!**/.turbo/**",
      "!**/.next/**",
      "!**/dist/**",
      "!**/coverage/**",
      "!**/node_modules/**"
    ]
  },
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "always" } }
}
```

```jsonc
// packages/schema/biome.json — only if the package needs deviations
{ "extends": ["//"], "linter": { "rules": { "suspicious": { "noExplicitAny": "off" } } } }
```

- **`files.includes`** with negated globs is the ignore mechanism for generated dirs
  (`.turbo`, `.next`, `dist`, `coverage`). Use `!**/name/**` form — bare `!name` only matches at
  the root and is unreliable in the LSP (biomejs/biome#7279).
- **`vcs.useIgnoreFile: true`** reuses `.gitignore` — do not duplicate entries. `vcs.root` must be
  set if `biome.json` lives outside the VCS root.
- `node_modules/` is always ignored regardless of `files.includes`.
- Nested configs are optional; a single root config plus `.gitignore` is the recommended default.
- Scripts: `"lint": "biome check ."`, `"format": "biome check --write ."` (no ESLint/Prettier —
  AGENTS.md). `.turbo` caching is safe because Biome hashes its own inputs.

## 7. Gotchas

- **Build order**: never rely on `pnpm -r build` alphabetical order for packages with
  references — always `tsc -b`.
- **Phantom dependencies**: pnpm strictness means a package can only import what it declares.
  Missing deps surface as `ERR_PACKAGE_PATH_NOT_EXPORTED` or resolution errors — add the dep,
  don't hoist around it.
- **Root package.json** is `private: true` and only holds orchestration scripts + shared
  devDependencies.
- **lockfile**: commit `pnpm-lock.yaml`; CI uses `pnpm install --frozen-lockfile` (also the
  reproducibility manifest input per SPEC.md §22).
