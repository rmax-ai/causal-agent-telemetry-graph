# Fastify + Zod Patterns — Type-Safe Routes, Validation, Errors, Plugins, Rate Limiting

> Companion research doc for CATG `apps/api` (SPEC.md §15, §18, §25). Versions current as of
> Aug 2026: Fastify 5.x, `@fastify/type-provider-zod` 1.x (requires Zod ≥ 4.2), `@fastify/rate-limit`
> 10.x, `@fastify/swagger` 9.x.
>
> Sources: fastify.dev/docs (Type-Providers), github.com/fastify/fastify-type-provider-zod,
> npmjs.com/package/@fastify/rate-limit.

## 1. Which Zod type-provider package

For **Zod v4 + Fastify 5** use the official **`@fastify/type-provider-zod`** (v1+, requires Zod
≥4.2). It uses Zod 4's `.encode()`/`.decode()` APIs, so **response serialization validates
against `z.output`** (post-transform), not `z.input`. The older community
`fastify-type-provider-zod` 5.x/6.x targets Zod v4.0/4.1 and the 4.x line targets Zod v3 — pick
per your `catalog:` entry.

## 2. Build the app with compilers + type provider

```ts
// apps/api/src/app.ts
import Fastify from "fastify";
import {
  ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod";
import { z } from "zod/v4";

export function buildApp() {
  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  // Required: swap Fastify's default JSON-schema compilers for Zod ones
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err, req, reply) => {
    // Request validation failure → 400 with Zod issues
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Request doesn't match the schema",
        issues: err.validation, // array of Zod issue objects
      });
    }
    // Response failed serialization → 500 (a bug in our contract)
    if (isResponseSerializationError(err)) {
      return reply.code(500).send({
        error: "Internal Server Error",
        message: "Response doesn't match the schema",
        issues: err.cause.issues,
      });
    }
    return reply.send(err); // default handling
  });

  return app;
}
```

Import `hasZodFastifySchemaValidationErrors` and `isResponseSerializationError` from
`@fastify/type-provider-zod`. Since v4 of the community package / v0+ of the official one, the
thrown object is a `FastifyError` with a `validation` field (not a raw `ZodError`) — these type
guards are the supported way to detect it.

## 3. Type-safe route schemas

`withTypeProvider<ZodTypeProvider>()` makes `req.params`, `req.query`, `req.body`, `req.headers`
fully typed from the schema. Define schemas in `packages/schema` (shared with the UI), reuse
them here:

```ts
// apps/api/src/routes/sessions.ts
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod/v4";
import { SessionGraphSchema, SessionSummarySchema } from "@catg/schema";

const GraphParams = z.object({
  id: z.string().regex(/^urn:catg:/, "must be a CATG URN"),
});

const GraphQuery = z.object({
  depth: z.coerce.number().int().min(1).max(10).default(3),
  truncate: z.coerce.number().int().max(1500).default(1500), // UI bound, SPEC.md §25
});

export const sessionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/sessions", {
    schema: {
      querystring: z.object({
        tenant: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      }),
      response: { 200: z.array(SessionSummarySchema) },
    },
    handler: async (req, reply) => {
      // req.query.limit is number; req.query.tenant is string | undefined
      reply.send(await listSessions(req.query));
    },
  });

  app.get("/sessions/:id/graph", {
    schema: {
      params: GraphParams,
      querystring: GraphQuery,
      response: { 200: SessionGraphSchema }, // includes truncation metadata
    },
    handler: async (req, reply) => {
      const { id } = req.params; // typed string
      const graph = await getSessionGraph(id, req.query);
      if (graph === null) return reply.code(404).send({ error: "Not Found" });
      return reply.send(graph);
    },
  });
};
```

Notes:

- **`z.coerce.number()`** is essential for query strings — everything arrives as a string.
- **`response` keyed by status code** (200, 204, 404…). Responses are serialized AND validated
  against `z.output`; a handler returning wrong-shaped data fails loudly instead of shipping
  broken JSON.
- **204/empty body**: use `z.undefined()` (`response: { 204: z.undefined() }`) so `res.send()`
  types are correct and OpenAPI is accurate.
- A **404 in `response`** is optional; if omitted, `reply.code(404).send(...)` is unchecked —
  declare it for contract completeness.

## 4. Plugin architecture

Plugins are encapsulated Fastify instances. Export an `async function` typed as
`FastifyPluginAsyncZod` and register it; use `fastify-plugin` only when decoration must leak
out of the encapsulation scope (e.g. a shared `db` decorator):

```ts
// apps/api/src/plugins/ledger.ts
import fp from "fastify-plugin";
import { openLedger, type EventLedger } from "@catg/event-ledger";

declare module "fastify" {
  interface FastifyInstance { ledger: EventLedger }
}

export default fp(async (app) => {
  const ledger = openLedger(app.config.ledgerPath);
  app.decorate("ledger", ledger);
  app.addHook("onClose", async () => ledger.close());
}, { name: "catg-ledger" });
```

```ts
// apps/api/src/server.ts
import { buildApp } from "./app.js";
import ledgerPlugin from "./plugins/ledger.js";
import { sessionRoutes } from "./routes/sessions.js";

const app = buildApp();
await app.register(ledgerPlugin);
await app.register(sessionRoutes, { prefix: "/api/v1" });
// routes register under /api/v1/sessions...
await app.listen({ port: 3000, host: "127.0.0.1" });
```

## 5. Rate limiting (`@fastify/rate-limit`)

Global limits plus per-route overrides; keyed by IP by default. For CATG, apply strict limits to
expensive endpoints (`/detections`, `/policy-evaluations`, `/experiments/runs`) and lax global
limits elsewhere:

```ts
import rateLimit from "@fastify/rate-limit";

await app.register(rateLimit, {
  global: true,
  max: 100,                 // default 1000
  timeWindow: "1 minute",   // ms number or ms-format string
  keyGenerator: (req) => req.ip ?? "unknown",
  errorResponseBuilder: (req, context) => ({
    error: "Too Many Requests",
    statusCode: 429,
    retryAfter: context.after,
  }),
  enableDraftSpec: true,    // IETF ratelimit-* headers instead of x-ratelimit-*
});
```

Per-route override (applies *in addition* to the global limit):

```ts
app.post("/detections", {
  config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  schema: { /* ... */ },
  handler: async (req, reply) => { /* ... */ },
});
```

Manual (non-route) limiting via `fastify.createRateLimit()` — useful for GraphQL-style single
endpoints or consume-on-failure semantics (e.g. failed logins):

```ts
const checkLoginLimit = app.createRateLimit({ max: 5, timeWindow: "1 minute" });

app.post("/login", async (req, reply) => {
  const status = await checkLoginLimit(req, { increment: false }); // peek, no consume
  if (status.isExceeded) return reply.code(429).send({ error: "Too Many Requests" });
  const ok = await tryLogin(req.body);
  if (!ok) { await checkLoginLimit(req); return reply.code(401).send({ error: "Invalid credentials" }); }
  return { ok: true };
});
```

## 6. OpenAPI from Zod (bonus)

`@fastify/type-provider-zod` ships `jsonSchemaTransform` so `@fastify/swagger` derives the spec
from route schemas automatically:

```ts
import swagger from "@fastify/swagger";
import { jsonSchemaTransform } from "@fastify/type-provider-zod";

await app.register(swagger, {
  openapi: { info: { title: "CATG API", version: "0.1.0" } },
  transform: jsonSchemaTransform,
});
```

Use `createJsonSchemaTransform({ zodToJsonConfig: { target: "jsonSchema2020-12" } })` if you
need a different JSON Schema target for OpenAPI compatibility.

## 7. Testing the API

Inject (no socket) is the primary pattern; `app.inject()` returns a light-weight response:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("GET /api/v1/sessions/:id/graph", () => {
  let app: ReturnType<typeof buildApp>;
  beforeEach(async () => { app = buildApp(); await app.ready(); });
  afterEach(async () => { await app.close(); });

  it("rejects a non-URN id with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/not-a-urn/graph" });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues.length).toBeGreaterThan(0);
  });

  it("validates response shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/sessions/urn:catg:t1:s1/graph" });
    expect(res.statusCode).toBe(200);
    expect(SessionGraphSchema.safeParse(res.json()).success).toBe(true);
  });
});
```

Coverage target for `apps/api` is ≥80% (SPEC.md §21).
