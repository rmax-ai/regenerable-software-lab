// @rsl/trace — TraceReader: async generator over JSONL trace files

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { TraceEvent } from "@rsl/benchmark-core";

export class TraceReader {
  /**
   * Async-generator that yields TraceEvent objects from a JSONL file.
   * Skips empty lines.  Throws if a non-empty line is not valid JSON or
   * does not conform to the TraceEvent shape.
   */
  async *readEvents(filePath: string): AsyncGenerator<TraceEvent> {
    const rl = createInterface({
      input: createReadStream(filePath, "utf-8"),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        throw new Error(
          `Invalid JSONL at line: ${trimmed.slice(0, 100)}`,
          { cause: err },
        );
      }
      yield parsed as TraceEvent;
    }
  }
}
