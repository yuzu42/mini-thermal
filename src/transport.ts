// ============================================================
// transport abstraction
// ============================================================
//
// the core never touches `serialport` directly — it writes bytes
// through this minimal interface. the Node adapter (mini-thermal/node)
// provides the SerialPort implementation; browsers could provide a
// Web Serial one; tests use MockTransport.

/**
 * a byte-oriented, ordered, write-mostly connection to a printer.
 * implementations must serialize concurrent `write` calls in order
 * and reject (not throw synchronously) on failures.
 */
export interface ByteTransport {
  /** opens the connection. resolving when already open is allowed. */
  open(): Promise<void>;
  /** writes bytes; resolves once the data is handed to the OS/driver. */
  write(data: Uint8Array): Promise<void>;
  /** closes the connection. resolving when already closed is allowed. */
  close(): Promise<void>;
  /** whether the connection is currently open. */
  readonly isOpen: boolean;
}

/**
 * in-memory transport for tests and dry runs. records every write
 * (defensively copied) so tests can assert on the exact byte stream.
 */
export class MockTransport implements ByteTransport {
  readonly writes: Uint8Array[] = [];
  private openState = false;
  private closed = false;

  async open(): Promise<void> {
    this.openState = true;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.openState) throw new Error('MockTransport: write before open()');
    this.writes.push(data.slice());
  }

  async close(): Promise<void> {
    this.openState = false;
    this.closed = true;
  }

  get isOpen(): boolean {
    return this.openState;
  }

  /** true once close() was called at least once */
  get wasClosed(): boolean {
    return this.closed;
  }

  /** total bytes written so far */
  get bytesWritten(): number {
    return this.writes.reduce((n, w) => n + w.length, 0);
  }

  /** all writes concatenated, in order */
  get stream(): Uint8Array {
    const out = new Uint8Array(this.bytesWritten);
    let off = 0;
    for (const w of this.writes) {
      out.set(w, off);
      off += w.length;
    }
    return out;
  }
}