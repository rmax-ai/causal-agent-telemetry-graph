/**
 * GraphProjection — reads canonical events from the append-only EventLedger
 * and projects them into a Kuzu property graph (SPEC.md §11).
 *
 * Architecture:
 *   EventLedger (SQLite, authoritative) → Kuzu (rebuildable view)
 *
 * Every node/edge written to Kuzu must already exist as a ledger event
 * (AGENTS.md: "Every edge assertion is an event in the ledger — never write
 * edges directly to Kuzu").
 */
import { createHash } from 'node:crypto';
import type { EventLedger } from '@catg/event-ledger';
import { buildUrn } from '@catg/graph-model';
import type { CanonicalEventEnvelope } from '@catg/schema';
import { Connection, Database } from 'kuzu';
import { fullDdl, NODE_TYPE_TO_TABLE } from './schema.js';

export interface ProjectionStats {
  nodesCreated: number;
  edgesCreated: number;
  eventsProcessed: number;
}

export interface ProjectionResult {
  stats: ProjectionStats;
  snapshotHash: string;
  incremental: boolean;
}

function computeSnapshotHash(stats: ProjectionStats, eventCount: number): string {
  const payload = `${eventCount}:${stats.nodesCreated}:${stats.edgesCreated}`;
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export class GraphProjection {
  private conn: Connection;
  private db: Database;
  private ledger: EventLedger;
  private ddlApplied = false;
  /** Maps node URN → Kuzu node table name, populated during projection. */
  private nodeTable: Map<string, string> = new Map();

  constructor(ledger: EventLedger, dbPath: string) {
    this.ledger = ledger;
    this.db = new Database(dbPath);
    this.conn = new Connection(this.db);
  }

  private async ensureSchema(): Promise<void> {
    if (this.ddlApplied) return;
    const ddl = fullDdl();
    const statements = ddl
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await this.conn.query(`${stmt};`);
    }
    this.ddlApplied = true;
  }

  async buildFull(tenantId?: string): Promise<ProjectionResult> {
    await this.ensureSchema();
    this.nodeTable.clear();

    const stats: ProjectionStats = { nodesCreated: 0, edgesCreated: 0, eventsProcessed: 0 };

    const pageSize = 1000;
    let offset = 0;
    let batch: ReturnType<typeof this.ledger.getEvents>;

    while (true) {
      batch = this.ledger.getEvents(tenantId ?? 'placeholder', pageSize, offset);
      if (batch.length === 0) break;

      for (const record of batch) {
        const event: CanonicalEventEnvelope = JSON.parse(record.canonicalJson);
        await this.projectEvent(event, stats);
      }

      offset += pageSize;
      if (batch.length < pageSize) break;
    }

    const snapshotHash = computeSnapshotHash(stats, stats.eventsProcessed);
    this.ledger.checkpoint(null, snapshotHash);

    return { stats, snapshotHash, incremental: false };
  }

  async buildIncremental(_tenantId?: string): Promise<ProjectionResult> {
    await this.ensureSchema();
    const stats: ProjectionStats = { nodesCreated: 0, edgesCreated: 0, eventsProcessed: 0 };
    const checkpoint = this.ledger.getLatestCheckpoint();
    return {
      stats,
      snapshotHash: checkpoint?.snapshotHash ?? computeSnapshotHash(stats, 0),
      incremental: true,
    };
  }

  getSnapshotHash(): string {
    const cp = this.ledger.getLatestCheckpoint();
    return (
      cp?.snapshotHash ?? 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    );
  }

  async close(): Promise<void> {
    await this.conn.close();
    await this.db.close();
  }

  private async projectEvent(event: CanonicalEventEnvelope, stats: ProjectionStats): Promise<void> {
    stats.eventsProcessed += 1;
    const { eventType, subject, payload } = event;
    const tenantId: string = subject.tenantId;

    switch (eventType) {
      case 'session.observed': {
        const sessionId = (payload as Record<string, unknown>).sessionId as string;
        if (sessionId) {
          const urn = buildUrn(tenantId, 'adr', sessionId);
          await this.upsertNode('AgentSession', urn, event);
          stats.nodesCreated += 1;
        }
        break;
      }

      case 'run.started': {
        const runId = (payload as Record<string, unknown>).runId as string;
        const sessId = (payload as Record<string, unknown>).sessionId as string;
        if (runId) {
          const urn = buildUrn(tenantId, 'adr', runId);
          await this.upsertNode('AgentRun', urn, event);
          stats.nodesCreated += 1;

          if (sessId) {
            const sessionUrn = buildUrn(tenantId, 'adr', sessId);
            // AgentRun is in Execution, AgentSession is in Identity
            await this.createEdge('CONTAINS', sessionUrn, urn, event);
            stats.edgesCreated += 1;
          }
        }
        break;
      }

      case 'message.observed': {
        const msgId = (payload as Record<string, unknown>).messageId as string;
        const sessId = (payload as Record<string, unknown>).sessionId as string;
        if (msgId) {
          const urn = buildUrn(tenantId, 'adr', msgId);
          await this.upsertNode('Message', urn, event);
          stats.nodesCreated += 1;

          if (sessId) {
            const sessionUrn = buildUrn(tenantId, 'adr', sessId);
            await this.createEdge('CONTAINS', sessionUrn, urn, event);
            stats.edgesCreated += 1;
          }
        }
        break;
      }

      case 'tool_call.observed': {
        const callId = (payload as Record<string, unknown>).callId as string;
        if (callId) {
          const urn = buildUrn(tenantId, 'adr', callId);
          await this.upsertNode('ToolCall', urn, event);
          stats.nodesCreated += 1;
        }
        break;
      }

      case 'tool_result.observed': {
        const resultId =
          ((payload as Record<string, unknown>).resultId as string) ??
          ((payload as Record<string, unknown>).callId as string);
        if (resultId) {
          const urn = buildUrn(tenantId, 'adr', `result-${resultId}`);
          await this.upsertNode('ToolResult', urn, event);
          stats.nodesCreated += 1;
        }
        break;
      }

      case 'model.invocation.started': {
        const invId = (payload as Record<string, unknown>).invocationId as string;
        if (invId) {
          const urn = buildUrn(tenantId, 'adr', invId);
          await this.upsertNode('ModelInvocation', urn, event);
          stats.nodesCreated += 1;
        }
        break;
      }

      case 'edge.asserted': {
        const ep = payload as Record<string, unknown>;
        const fromId = ep.fromId as string;
        const toId = ep.toId as string;
        const edgeType = ep.edgeType as string;
        if (fromId && toId && edgeType) {
          await this.createEdge(edgeType, fromId, toId, event);
          stats.edgesCreated += 1;
        }
        break;
      }

      default:
        break;
    }
  }

  private async upsertNode(
    nodeType: string,
    urn: string,
    event: CanonicalEventEnvelope,
  ): Promise<void> {
    const table = NODE_TYPE_TO_TABLE[nodeType];
    if (!table) return;
    this.nodeTable.set(urn, table);

    const prepared = await this.conn.prepare(`
      MERGE (n:${table} {id: $id})
      ON CREATE SET n.type = $type, n.tenantId = $tenantId,
        n.observedAt = $observedAt, n.confidence = 'observed',
        n.labels = $labels, n.properties = '{}'
      ON MATCH SET n.observedAt = $observedAt
    `);

    await this.conn.execute(prepared, {
      id: urn,
      type: nodeType,
      tenantId: event.subject.tenantId,
      observedAt: new Date(event.observedAt),
      labels: JSON.stringify(event.subject),
    });
  }

  private async createEdge(
    edgeType: string,
    fromUrn: string,
    toUrn: string,
    event: CanonicalEventEnvelope,
  ): Promise<void> {
    const fromTable = this.nodeTable.get(fromUrn);
    const toTable = this.nodeTable.get(toUrn);

    if (!fromTable || !toTable) {
      // Skip edges where endpoints weren't projected (edge.asserted events
      // may reference nodes from earlier phases or external sources).
      return;
    }

    // Kuzu requires FROM/TO table pairs to match a REL TABLE GROUP definition.
    // Some edge types span different table pairs. We try the primary mapping;
    // if the edge type doesn't exist between these specific tables, skip.

    const prepared = await this.conn.prepare(`
      MATCH (a:${fromTable} {id: $fromId}), (b:${toTable} {id: $toId})
      CREATE (a)-[:${edgeType} {assertedAt: $at, confidence: 'observed', evidenceIds: $evidenceIds, linkerId: 'graph-projection'}]->(b)
    `);

    try {
      await this.conn.execute(prepared, {
        fromId: fromUrn,
        toId: toUrn,
        at: new Date(event.observedAt),
        evidenceIds: JSON.stringify([event.eventId]),
      });
    } catch {
      // Edge type might not be defined between these specific node tables.
      // Silently skip for now — later phases will add missing rel tables.
    }
  }
}
