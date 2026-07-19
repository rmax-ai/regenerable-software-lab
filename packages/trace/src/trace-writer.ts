// @rsl/trace — TraceWriter: appends TraceEvents as JSONL to a file

import { createWriteStream, type WriteStream } from "node:fs";
import type { TraceEvent } from "@rsl/benchmark-core";

export class TraceWriter {
  private stream: WriteStream | null = null;
  private closed = false;

  /**
   * Open a write stream to the given file path.
   * Creates the file if it does not exist; appends if it does.
   */
  createWriteStream(filePath: string): void {
    if (this.stream) {
      throw new Error("TraceWriter already has an open stream");
    }
    this.stream = createWriteStream(filePath, {
      encoding: "utf-8",
      flags: "a",
    });
    this.closed = false;
  }

  /**
   * Write a single TraceEvent as a JSONL line.
   * Returns true if the write succeeded (kernel buffer accepted).
   */
  writeEvent(event: TraceEvent): boolean {
    if (!this.stream) {
      throw new Error("TraceWriter stream not opened");
    }
    if (this.closed) {
      throw new Error("TraceWriter already closed");
    }
    const line = JSON.stringify(event) + "\n";
    return this.stream.write(line);
  }

  /**
   * Close the write stream.  Returns a promise that resolves when the
   * underlying file descriptor has been flushed and closed.
   */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.stream) {
        resolve();
        return;
      }
      this.closed = true;
      this.stream.end(() => {
        this.stream = null;
        resolve();
      });
      this.stream.on("error", reject);
    });
  }
}
