#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adapterAdr } from '@catg/adapters-adr';
import { EventLedger } from '@catg/event-ledger';
import { GraphProjection } from '@catg/graph-projection';
import { importEvents } from '@catg/ingestion-core';
/**
 * CATG CLI — command-line interface for the Causal Agent Telemetry Graph.
 *
 * Commands:
 *   catg import adr --file <path>       Import ADR telemetry
 *   catg session list [--tenant <id>]   List sessions
 *   catg session show <id>              Show session details
 *   catg graph path <from> <to>         Find paths in the graph
 */
import { Command } from 'commander';

const program = new Command();

program
  .name('catg')
  .description('Causal Agent Telemetry Graph — agent workflow security analysis')
  .version('0.1.0');

// ─── import adr ──────────────────────────────────────────────────────────

program
  .command('import')
  .command('adr')
  .description('Import ADR AgentEvent JSON into the CATG ledger')
  .requiredOption('--file <path>', 'Path to ADR JSON file (JSON or JSONL)')
  .option('--db <path>', 'SQLite ledger path', './data/catg.db')
  .option('--graph-db <path>', 'Kuzu graph DB path', './data/graph')
  .option('--tenant <id>', 'Tenant ID', 'default')
  .option('--no-project', 'Skip graph projection after import')
  .action(async (opts) => {
    const raw = readFileSync(resolve(opts.file), 'utf-8');
    const { events, errors } = adapterAdr(raw);

    if (errors.length > 0) {
      for (const err of errors) {
        console.error(`⚠ ${err}`);
      }
    }

    if (events.length === 0) {
      console.log('No events produced.');
      process.exit(errors.length > 0 ? 1 : 0);
    }

    const ledger = new EventLedger(opts.db);
    const result = await importEvents(ledger, events, { tenantId: opts.tenant });

    console.log(`Imported: ${result.stats.imported}`);
    console.log(`Duplicates: ${result.stats.duplicates}`);
    console.log(`Quarantined: ${result.stats.quarantined}`);
    console.log(`Errors: ${result.stats.errors}`);

    if (opts.project) {
      const projection = new GraphProjection(ledger, opts.graphDb);
      const projResult = await projection.buildFull(opts.tenant);
      console.log(
        `Projected: ${projResult.stats.nodesCreated} nodes, ${projResult.stats.edgesCreated} edges`,
      );
      await projection.close();
    }

    ledger.close();
  });

// ─── session ─────────────────────────────────────────────────────────────

const sessionCmd = program.command('session').description('Session operations');

sessionCmd
  .command('list')
  .description('List sessions in the ledger')
  .option('--db <path>', 'SQLite ledger path', './data/catg.db')
  .option('--tenant <id>', 'Tenant ID', 'default')
  .option('--limit <n>', 'Max results', '20')
  .action((opts) => {
    const ledger = new EventLedger(opts.db);
    const events = ledger.getEvents(opts.tenant, parseInt(opts.limit, 10));
    const sessions = new Set<string>();
    for (const ev of events) {
      const parsed = JSON.parse(ev.canonicalJson);
      if (parsed.eventType === 'session.observed' && parsed.payload?.sessionId) {
        sessions.add(parsed.payload.sessionId as string);
      }
    }
    if (sessions.size === 0) {
      console.log('No sessions found.');
    } else {
      console.log('Sessions:');
      for (const sid of sessions) {
        console.log(`  ${sid}`);
      }
    }
    console.log(`\nTotal events: ${events.length}`);
    ledger.close();
  });

sessionCmd
  .command('show')
  .description('Show details for a session')
  .argument('<id>', 'Session ID')
  .option('--db <path>', 'SQLite ledger path', './data/catg.db')
  .option('--tenant <id>', 'Tenant ID', 'default')
  .action((id, opts) => {
    const ledger = new EventLedger(opts.db);
    const events = ledger.getEvents(opts.tenant, 1000);
    const sessionEvents = events.filter((ev) => {
      const parsed = JSON.parse(ev.canonicalJson);
      return parsed.eventType === 'session.observed' && parsed.payload?.sessionId === id;
    });
    if (sessionEvents.length === 0) {
      console.log(`Session ${id} not found.`);
    } else {
      for (const ev of sessionEvents) {
        const parsed = JSON.parse(ev.canonicalJson);
        console.log(JSON.stringify(parsed, null, 2));
      }
    }
    ledger.close();
  });

// ─── graph ───────────────────────────────────────────────────────────────

const graphCmd = program.command('graph').description('Graph operations');

graphCmd
  .command('path')
  .description('Find paths between two nodes in the Kuzu graph')
  .argument('<from>', 'Source node URN or partial ID')
  .argument('<to>', 'Target node URN or partial ID')
  .option('--graph-db <path>', 'Kuzu graph DB path', './data/graph')
  .action(async (from, to, opts) => {
    const { Database, Connection } = await import('kuzu');
    const db = new Database(opts.graphDb);
    const conn = new Connection(db);

    try {
      // conn.query() returns QueryResult | QueryResult[] in types,
      // but for single statements it's always a single QueryResult.
      const result = await conn.query(`
        MATCH path = (a)-[*1..5]->(b)
        WHERE a.id CONTAINS '${from}' AND b.id CONTAINS '${to}'
        RETURN path
        LIMIT 10
      `);
      const qr = result as import('kuzu').QueryResult;
      const rows = qr.getAllSync();

      if (rows.length === 0) {
        console.log('No paths found.');
      } else {
        rows.forEach((row: Record<string, unknown>, i: number) => {
          console.log(`Path ${i + 1}:`, JSON.stringify(row));
        });
      }
      qr.close();
    } finally {
      await conn.close();
      await db.close();
    }
  });

// Only parse when executed directly (not imported for testing)
const isMain =
  process.argv[1]?.includes('catg') ||
  process.argv[1]?.endsWith('/cli/src/index.ts') ||
  process.argv[1]?.endsWith('/cli/src/index.js');
if (isMain) {
  program.parse();
}

export const VERSION = '0.1.0';
