// @rsl/cli — rsl trace command
// Inspect trace events from a benchmark run

import { Command } from "commander";
import { createReadStream, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { TraceEventSchema } from "@rsl/benchmark-core";

export const traceCommand = new Command("trace")
  .description("Inspect trace events from a benchmark run")
  .argument("<path>", "Path to trace.jsonl or run workspace directory")
  .option("-f, --filter <type>", "Filter events by type substring")
  .option("--source <source>", "Filter by event source")
  .option("-l, --limit <number>", "Max events to display", "50")
  .option("--json", "Output raw JSON-per-line instead of formatted table")
  .action(async (traceArg: string, options: Record<string, unknown>) => {
    try {
      let tracePath = resolve(traceArg);

      // If it's a directory, look for trace/trace.jsonl inside
      if (existsSync(tracePath)) {
        const stat = await import("node:fs/promises").then(m => m.stat(tracePath));
        if (stat.isDirectory()) {
          tracePath = resolve(tracePath, "trace", "trace.jsonl");
        }
      }

      if (!existsSync(tracePath)) {
        console.error(
          `rsl trace: trace file not found: ${tracePath}`,
        );
        process.exitCode = 1;
        return;
      }

      const filterType = options.filter as string | undefined;
      const filterSource = options.source as string | undefined;
      const limit = Number(options.limit) || 50;
      const outputJson = options.json === true;

      const readStream = createReadStream(tracePath, {
        encoding: "utf-8",
      });
      const rl = createInterface({ input: readStream });

      const events: Array<Record<string, unknown>> = [];
      let parseErrors = 0;

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          const validation = TraceEventSchema.safeParse(parsed);

          if (!validation.success) continue;

          const event = validation.data as unknown as Record<string, unknown>;

          if (filterType) {
            const eventType = String(event.type ?? "");
            if (!eventType.toLowerCase().includes(filterType.toLowerCase())) {
              continue;
            }
          }

          if (filterSource) {
            if (event.source !== filterSource) continue;
          }

          events.push(event);
        } catch {
          parseErrors++;
          continue;
        }
      }

      readStream.close();

      if (parseErrors > 0 && events.length === 0) {
        console.error(
          `rsl trace: warning: ${parseErrors} parse errors in trace file`,
        );
      }

      const displayEvents = events.slice(0, limit);

      if (outputJson) {
        for (const event of displayEvents) {
          console.log(JSON.stringify(event));
        }
      } else {
        const header =
          "seq  timestamp                    source         type                          payload";
        const separator =
          "─".repeat(header.length);

        console.log(header);
        console.log(separator);

        for (const evt of displayEvents) {
          const seq = String(evt.sequence ?? "").padEnd(4);
          const ts = String(evt.timestamp ?? "").padEnd(28).slice(0, 28);
          const src = String(evt.source ?? "").padEnd(14).slice(0, 14);
          const type = String(evt.type ?? "").padEnd(30).slice(0, 30);
          const payload = evt.payload
            ? JSON.stringify(evt.payload).slice(0, 60)
            : "";
          console.log(`${seq} ${ts} ${src} ${type} ${payload}`);
        }
      }

      const total = events.length;
      const shown = displayEvents.length;

      if (total > shown) {
        console.error(
          `rsl trace: showing ${shown} of ${total} events (use --limit to see more)`,
        );
      } else {
        console.error(`rsl trace: ${total} events`);
      }

      if (parseErrors > 0) {
        console.error(
          `rsl trace: ${parseErrors} unparseable lines skipped`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("rsl trace: error:", message);
      process.exitCode = 1;
    }
  });
