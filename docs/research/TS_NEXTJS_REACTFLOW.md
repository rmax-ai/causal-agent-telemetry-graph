# Next.js App Router + TanStack Query + React Flow — Causal Graph Investigation UI

> Companion research doc for CATG `apps/investigator-ui` (SPEC.md §17, §25). Versions current as
> of Aug 2026: Next.js 16 (App Router, Turbopack), TanStack Query v5, React Flow v12
> (`@xyflow/react`). The UI is **API-only — no direct DB access** (SPEC.md §20).
>
> Sources: nextjs.org/docs (App Router, transpilePackages), tanstack.com/query (SSR + Advanced
> SSR), reactflow.dev (Performance, API reference, Common Errors).

## 1. Data-fetching split: Server Components + TanStack Query

Pattern: **server components prefetch and dehydrate; client components consume via hooks**.
This flattens waterfalls (parallel route fetches) and gives instant first paint with no client
round-trip, while keeping interactivity in React Query's cache.

```tsx
// app/providers.tsx — client boundary, mounted once in root layout
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,          // avoid immediate client refetch after SSR
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

```tsx
// app/layout.tsx
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
```

```tsx
// app/sessions/[id]/page.tsx — server component: prefetch + dehydrate
import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { getSessionGraph } from "@/lib/api";
import { GraphView } from "./graph-view";

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // Next 15+/16: params is a Promise
  const queryClient = new QueryClient(); // fresh per request — never share across users

  await queryClient.prefetchQuery({
    queryKey: ["sessions", id, "graph"],
    queryFn: () => getSessionGraph(id, { depth: 3, truncate: 1500 }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GraphView sessionId={id} />
    </HydrationBoundary>
  );
}
```

```tsx
// app/sessions/[id]/graph-view.tsx — client component
"use client";
import { useQuery } from "@tanstack/react-query";

export function GraphView({ sessionId }: { sessionId: string }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["sessions", sessionId, "graph"],
    queryFn: () => getSessionGraph(sessionId, { depth: 3, truncate: 1500 }),
  });
  // data is immediately available from the dehydrated cache
  return <CausalGraph nodes={data.nodes} edges={data.edges} truncation={data.truncation} />;
}
```

- **Query keys are structured arrays**: `["sessions", id, "graph"]` — invalidate/refetch by key
  prefix (`queryClient.invalidateQueries({ queryKey: ["sessions"] })`).
- For streaming SSR, `useSuspenseQuery` + pending-promise dehydration is the alternative; the
  prefetch pattern above is the recommended default.
- Server components must not import React Query hooks; keep the `"use client"` boundary at the
  interactive leaf.

## 2. Server-side graph filtering (the 1,500-element bound)

SPEC.md §25: **UI never renders >1,500 elements simultaneously**; the graph endpoint returns
server-side filtered subgraphs with `truncation` metadata (SPEC.md §15, §17). Client code must
assume data is already bounded — no client-side re-filtering of huge graphs:

```ts
// lib/api.ts — typed against @catg/schema (shared with the API)
import type { SessionGraph } from "@catg/schema";

export async function getSessionGraph(sessionId: string, opts: { depth: number; truncate: number }): Promise<SessionGraph> {
  const res = await fetch(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/graph?depth=${opts.depth}&truncate=${opts.truncate}`,
    { next: { revalidate: 0 } }, // never cache investigation data
  );
  if (!res.ok) throw new Error(`graph fetch failed: ${res.status}`);
  return res.json();
}
```

## 3. React Flow v12 essentials

```bash
pnpm --filter @catg/investigator-ui add @xyflow/react
```

```tsx
"use client";
import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow, Background, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css"; // required — missing import = no edges rendered
import { CausalNode } from "./nodes/causal-node";
import { ConfidenceEdge } from "./edges/confidence-edge";

// Define ONCE at module scope — a nodeTypes object created inside the component
// is a new reference every render and forces React Flow to re-render everything.
const nodeTypes = { causal: CausalNode };
const edgeTypes = { confidence: ConfidenceEdge };

export function CausalGraph({ nodes: initialNodes, edges: initialEdges }: GraphProps) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  // Memoize change handlers — new function identity per render also causes re-renders
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onlyRenderVisibleElements // render only viewport-visible nodes/edges (see §4)
      minZoom={0.1}
      fitView
    >
      <Background variant="dots" gap={20} />
    </ReactFlow>
  );
}
```

## 4. Performance with 1,000+ nodes

React Flow is DOM-based; practical ceiling is ~1,000 nodes depending on node complexity
(xyflow#967). CATG's bound is 1,500 elements — so the strategy is **defense in depth**:

1. **Server-side filtering first** (§2): the API caps what the UI ever receives. This is the
   primary mechanism, not rendering tricks.
2. **`onlyRenderVisibleElements`** (default `false`): renders only nodes/edges intersecting the
   viewport. Caveats: it adds per-pan re-init overhead (can be *slower* for many small nodes,
   xyflow#967), and works best with fixed node `width`/`height` or measured + defined handles
   (since v12.8.5 nodes with defined handles are skipped initially, xyflow#5497). Benchmark
   both settings against the 1,000-node fixture.
3. **`React.memo` every custom node/edge component** and keep `nodeTypes`/`edgeTypes` outside the
   component (module scope or `useMemo`) — the single most common perf bug (React Flow warns on
   inline `nodeTypes`).
4. **Decouple selection/hover state from the `nodes`/`edges` arrays**: storing
   `selectedNodeIds` separately (local state) avoids re-rendering every node on selection
   change. Style selection via CSS (`.react-flow__node.selected`) instead of mutating all nodes.
5. **Keep styles cheap**: avoid shadows/gradients/animations on node styles at scale; prefer
   plain fills. For edge animations, `stroke-dasharray` on hundreds of animated edges is a known
   Safari/CPU bottleneck — disable `animated` and animate a marker along the path instead
   (route06 pattern).

## 5. Confidence-based edge styling

AGENTS.md ordering: `observed > declared > reconstructed > inferred > speculative`. Encode
confidence in stroke color, dash pattern, and opacity so inferred/speculative edges are
visibly distinct (ROADMAP Phase 4 acceptance: "Inferred edges visibly distinct").

```tsx
// edges/confidence-edge.tsx
import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { EdgeConfidence } from "@catg/schema";

const CONFIDENCE_STYLE: Record<EdgeConfidence, { stroke: string; strokeDasharray?: string; opacity: number }> = {
  observed:     { stroke: "#16a34a", opacity: 1 },
  declared:     { stroke: "#2563eb", opacity: 0.95 },
  reconstructed:{ stroke: "#7c3aed", opacity: 0.9 },
  inferred:     { stroke: "#d97706", strokeDasharray: "6 4", opacity: 0.85 },
  speculative:  { stroke: "#94a3b8", strokeDasharray: "2 4", opacity: 0.6 },
};

type ConfidenceEdgeData = { confidence: EdgeConfidence; label?: string };

export const ConfidenceEdge = memo(function ConfidenceEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  data, markerEnd, label,
}: EdgeProps<ConfidenceEdgeData>) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const style = CONFIDENCE_STYLE[data.confidence];
  return <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} label={label} />;
});
```

Edge data carries the full assertion (`confidence`, `causalBasis`, `evidenceIds`, `linkerVersion`)
from the API so a tooltip/inspector can render provenance without extra fetches. Every displayed
edge must expose its confidence + evidence (SPEC.md §17 investigation rule).

## 6. Monorepo wiring

```ts
// next.config.ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  transpilePackages: ["@catg/schema", "@catg/graph-model", "@catg/query-sdk"],
  output: "standalone",
};
export default nextConfig;
```

See `TS_MONOREPO.md` §3/§5 for `.npmrc` `public-hoist-pattern` (react/react-dom) and
`pnpm.overrides` — without them Turbopack can resolve duplicate React instances in CI.
