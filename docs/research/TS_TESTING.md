# Vitest Workspace Patterns — Projects, Golden Tests, fast-check, Fake Providers, Playwright

> Companion research doc for CATG testing strategy (SPEC.md §21, AGENTS.md "Testing
> Requirements"). Versions current as of Aug 2026: Vitest 4.x, fast-check 4.x,
> `@fast-check/vitest` 0.3.x, Playwright 1.5x.
>
> Sources: vitest.dev/guide/projects, vitest.dev/blog/vitest-3-2, npmjs.com/package/@fast-check/vitest,
> fast-check.dev/docs, playwright.dev/docs.

## 1. Vitest 4: `projects`, not `workspace`

Vitest 3.2 deprecated the `vitest.workspace` file in favor of the `projects` option; **Vitest 4.0
removed `workspace` entirely**. Any tutorial referencing `test.workspace` is outdated.

Two complementary setups:

**A. Per-package configs (CI)** — each package owns `vitest.config.ts` + a `"test": "vitest run"`
script, so CI can run/test only changed packages. `vitest run` (not bare `vitest`, which enters
watch mode and never exits in CI).

**B. Root projects config (local)** — one root `vitest.config.ts` runs everything with merged
coverage:

```ts
// vitest.config.ts (root)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",            // every folder under packages/ = one project
      "apps/api",              // or glob to config files: "apps/*/vitest.config.{unit,e2e}.ts"
    ],
    // coverage and reporters live ONLY at the root (not per-project)
    coverage: { provider: "v8", reporter: ["text", "html", "lcov"] },
    reporters: ["default"],
  },
});
```

Per-package config — use `defineProject` (rejects root-only options like `reporters` at type
level) and `mergeConfig` to share defaults:

```ts
// packages/schema/vitest.config.ts
import { defineProject, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared";

export default mergeConfig(
  shared, // shared: { test: { environment: "node", include: ["src/**/*.test.ts"] } }
  defineProject({ test: { name: "schema" } }),
);
```

Inline projects inherit root options with `extends: true` (the default since Vitest 4; set
`extends: false` to isolate). `name`, `projects`, and `globalSetup` are never inherited. All
project names must be unique (package.json `name` is used when present).

## 2. Global setup + providing data to tests

`globalSetup` runs once per test run **before workers spawn** — do DB/file scaffolding there and
pass serializable values down with `provide`/`inject`. For per-file setup that must run in the
same process as tests, use `setupFiles` instead.

```ts
// vitest.global-setup.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

export default function setup(project: TestProject) {
  const scratch = mkdtempSync(join(tmpdir(), "catg-test-"));
  project.provide("scratchDir", scratch); // read in tests via inject("scratchDir")
  return () => rmSync(scratch, { recursive: true, force: true }); // teardown
}
```

```ts
// vitest.config.ts
export default defineConfig({
  test: { globalSetup: ["./vitest.global-setup.ts"] },
});
```

```ts
import { inject } from "vitest";

it("projects into a scratch Kuzu DB", () => {
  const dir = inject<string>("scratchDir");
  // use dir for the Kuzu Database(":memory:") or ledger path
});
```

## 3. Golden tests (adapters)

Golden tests pin adapters to exact canonical output: input fixture → *exact* events + graph
(AGENTS.md requirement 2). Store `.golden.json` files under `__fixtures__/` next to the package;
compare canonical JSON, normalizing only non-deterministic fields (timestamps, hashes you
explicitly regenerate).

```ts
// packages/adapters-adr/__tests__/golden.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adrToCanonicalEvents } from "../src/adapter";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "..", "__fixtures__", name), "utf8"));

describe("ADR golden fixtures", () => {
  it("benign trace → exact canonical events incl. edge.asserted events", () => {
    const events = [...adrToCanonicalEvents(fixture("benign.agent-events.json"))];
    expect(events.some((e) => e.eventType === "edge.asserted")).toBe(true);
    expect(normalize(events)).toEqual(fixture("benign.events.golden.json"));
  });
  // one golden file per fixture: benign, credential-exfiltration, partial-session
});

// Normalize non-deterministic fields (derived hashes stay; clocks are zeroed)
function normalize<T>(events: T[]): T[] {
  return structuredClone(events).map((e) => ({ ...e, observedAt: "T", integrityHash: "H" }));
}
```

Golden files are regenerated intentionally (`UPDATE_GOLDEN=1 pnpm test` helper that rewrites the
fixtures) and reviewed in the PR — never blindly. Golden tests run in CI (AGENTS.md).

## 4. Property-based testing with fast-check

Target properties from AGENTS.md: idempotency, ordering independence, cross-tenant isolation.

```ts
// packages/event-ledger/__tests__/dedupe.property.test.ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dedupeKey, appendBatch } from "../src/ledger";

const eventArb = fc.record({
  tenantId: fc.string({ minLength: 1, maxLength: 16 }),
  sourceKind: fc.constantFrom("adr", "otel", "mcp"),
  eventType: fc.constantFrom("message.observed", "tool_call.observed"),
  occurredAt: fc.date(),
  payload: fc.string(),
});

describe("ledger idempotency", () => {
  it("append is idempotent: re-appending the same batch adds nothing", () => {
    fc.assert(
      fc.property(fc.uniqueArray(eventArb, { maxLength: 50 }), (events) => {
        const first = appendBatch(events);
        const second = appendBatch(events);
        expect(second.appended).toBe(0);
        expect(second.duplicates).toBe(first.appended);
        expect(countEvents()).toBe(first.appended); // total rows unchanged
      }),
      { numRuns: 100 },
    );
  });

  it("cross-tenant isolation: dedupe keys differ across tenants", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(eventArb, { minLength: 2 }),
        fc.string({ minLength: 1 }),
        (events, otherTenant) => {
          const [e1, e2] = events;
          expect(dedupeKey({ ...e1, tenantId: otherTenant })).not.toBe(dedupeKey(e2));
        },
      ),
    );
  });
});
```

- `fc.assert(fc.property(...arbitraries, predicate))` — predicate may `expect()` or return a
  boolean; use `fc.asyncProperty` for async predicates. Useful composites: `fc.record`,
  `fc.uniqueArray(arb, { selector })`, `fc.array(arb, { minLength, maxLength })`,
  `fc.constantFrom`, `fc.oneof`, `fc.gen()`. On failure fast-check shrinks to a minimal
  counterexample automatically.

**`@fast-check/vitest`** provides a first-class `test.prop` integration (v0.2.3+ supports Vitest 4):

```ts
import { test } from "@fast-check/vitest";

test.prop([fc.uniqueArray(fc.uuid(), { maxLength: 20 })], (ids) => {
  expect(roundTrip(ids)).toEqual(ids);
});
```

## 5. Fake providers for LLM detectors

`packages/detectors-llm` must be testable without network/keys. Define a provider interface and
a deterministic fake returning canned verdicts keyed by evidence hash:

```ts
// packages/detector-sdk/src/provider.ts
export interface DetectorProvider {
  readonly name: string;
  classify(request: DetectionRequest): Promise<DetectionResult>;
}

// packages/detectors-llm/__tests__/fake-provider.ts
export class FakeProvider implements DetectorProvider {
  readonly name = "fake-provider";
  constructor(private table: Map<string, DetectionResult>) {}
  async classify(request: DetectionRequest): Promise<DetectionResult> {
    const canned = this.table.get(request.evidenceHash); // deterministic, no network
    if (!canned) throw new Error(`no canned verdict for ${request.evidenceHash}`);
    return canned;
  }
}
```

Usage in tests: `new FakeProvider(new Map([["ev-1", { verdict: "clean", confidence: 0.9 }]]))`
injected via constructor (or `vi.mock`). Assert fail-closed behavior — unknown evidence hash
rejects, and malformed detector output fails the strict output schema (SPEC.md §14). No detector
code path touches a real SDK in unit tests.

## 6. Playwright E2E (investigator UI critical flows)

Separate Playwright config; `webServer` boots the Next app (and optionally the API) before
tests. Mock the API with `page.route` for deterministic fixtures, and run one true
integration spec against the real API.

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:3000", trace: "on-first-retry" },
  webServer: {
    command: "pnpm --filter @catg/investigator-ui dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // { name: "firefox", use: { ...devices["Desktop Firefox"] } },  // optional
  ],
});
```

```ts
// e2e/graph-view.spec.ts
import { expect, test } from "@playwright/test";

test("session list → graph view renders confidence-styled edges", async ({ page }) => {
  await page.route("**/api/v1/sessions*", (route) =>
    route.fulfill({ json: fixtures.sessionList }),
  );
  await page.route("**/api/v1/sessions/sess-17/graph*", (route) =>
    route.fulfill({ json: fixtures.sessionGraph }),
  );

  await page.goto("/sessions");
  await expect(page.getByRole("link", { name: /sess-17/ })).toBeVisible();
  await page.getByRole("link", { name: /sess-17/ }).click();

  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas).toBeVisible();
  // inferred edges are visibly distinct (dashed stroke per TS_NEXTJS_REACTFLOW.md §5)
  await expect(canvas.locator(".react-flow__edge-inferred").first()).toBeVisible();
  await expect(canvas.locator(".react-flow__edge-observed").first()).toBeVisible();
});
```

Add `className` per confidence on edges (e.g. `react-flow__edge-inferred`) so E2E assertions
target semantics, not pixels. Wire `pnpm e2e` to `playwright test`; run in CI after
unit/golden tests (AGENTS.md CI/CD).

## 7. Test pyramid recap (SPEC.md §21)

| Layer | Tooling | Target |
|---|---|---|
| Unit (schemas, policies) | Vitest | schema/policy ≥90% |
| Golden (adapters) | Vitest + fixtures | ingestion/linker ≥85% |
| Property-based | fast-check | idempotency, ordering, isolation |
| Integration (SQLite→Kuzu, pipelines) | Vitest + globalSetup scratch dirs | — |
| E2E (UI critical flows) | Playwright | Phase 4 acceptance |
