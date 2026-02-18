/**
 * Minimal LSP JSON-RPC client over stdio.
 *
 * Spawns a language server process, sends requests via Content-Length framed
 * JSON-RPC 2.0, and correlates responses by ID.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface LspClientOptions {
  command: string[];
  rootUri: string;
  initializationOptions?: Record<string, unknown>;
  env?: Record<string, string>;
}

export class LspClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private openDocuments = new Set<string>();
  private docVersions = new Map<string, number>();
  private initialized = false;
  private _capabilities: any = {};

  get capabilities() {
    return this._capabilities;
  }

  async start(options: LspClientOptions): Promise<void> {
    const [cmd, ...args] = options.command;
    this.proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...options.env },
    });

    this.proc.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr!.on("data", (chunk: Buffer) => {
      // Log but don't crash — RA is chatty on stderr
      const msg = chunk.toString().trim();
      if (msg) this.emit("log", msg);
    });

    this.proc.on("exit", (code) => {
      this.emit("exit", code);
      // Reject all pending requests
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`LSP server exited with code ${code}`));
      }
      this.pending.clear();
      this.initialized = false;
      this.proc = null;
    });

    // Initialize handshake
    const initResult = await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${options.rootUri}`,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["plaintext", "markdown"] },
          definition: {},
          references: {},
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
        },
        workspace: {
          symbol: {},
        },
      },
      initializationOptions: options.initializationOptions ?? {},
    });

    this._capabilities = initResult?.capabilities ?? {};
    this.notify("initialized", {});
    this.initialized = true;
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.proc?.kill();
          resolve();
        }, 2000);
        this.proc?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch {
      // Best effort
      this.proc?.kill();
    }
    this.proc = null;
    this.initialized = false;
    this.openDocuments.clear();
  }

  isRunning(): boolean {
    return this.proc !== null && this.initialized;
  }

  /**
   * Ensure a document is open. LSP requires textDocument/didOpen before queries.
   */
  ensureOpen(filePath: string, content: string, languageId: string): void {
    const uri = `file://${filePath}`;
    if (this.openDocuments.has(uri)) return;
    const version = (this.docVersions.get(uri) ?? 0) + 1;
    this.docVersions.set(uri, version);
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version,
        text: content,
      },
    });
    this.openDocuments.add(uri);
  }

  /**
   * Close and reopen a document to refresh the server's view after edits.
   * No-op if the document was never opened.
   */
  refreshDocument(filePath: string, content: string, languageId: string): void {
    const uri = `file://${filePath}`;
    if (!this.openDocuments.has(uri)) return;
    this.notify("textDocument/didClose", { textDocument: { uri } });
    this.openDocuments.delete(uri);
    this.ensureOpen(filePath, content, languageId);
  }

  async hover(filePath: string, line: number, col: number, signal?: AbortSignal): Promise<any> {
    return this.request("textDocument/hover", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
    }, signal);
  }

  async definition(filePath: string, line: number, col: number, signal?: AbortSignal): Promise<any> {
    return this.request("textDocument/definition", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
    }, signal);
  }

  async references(filePath: string, line: number, col: number, includeDeclaration = true, signal?: AbortSignal): Promise<any> {
    return this.request("textDocument/references", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
      context: { includeDeclaration },
    }, signal);
  }

  async documentSymbol(filePath: string, signal?: AbortSignal): Promise<any> {
    return this.request("textDocument/documentSymbol", {
      textDocument: { uri: `file://${filePath}` },
    }, signal);
  }

  async workspaceSymbol(query: string, signal?: AbortSignal): Promise<any> {
    return this.request("workspace/symbol", { query }, signal);
  }

  // --- JSON-RPC transport ---

  private request(method: string, params: any, signal?: AbortSignal): Promise<any> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("Cancelled"));
      const id = this.nextId++;
      const cleanup = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error("Cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          cleanup();
          reject(new Error(`LSP request '${method}' timed out after 30s`));
        }
      }, 30000);
      this.pending.set(id, {
        resolve: (v) => { cleanup(); resolve(v); },
        reject: (e) => { cleanup(); reject(e); },
        timer,
      });
      if (!this.send({ jsonrpc: "2.0", id, method, params })) {
        cleanup();
        reject(new Error("LSP server not running"));
      }
    });
  }

  private notify(method: string, params: any): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  /** Returns false if the server is not running (message silently dropped). */
  private send(msg: any): boolean {
    if (!this.proc?.stdin?.writable) return false;
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.proc.stdin.write(header + body);
    return true;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.contentLength < 0) {
        // Look for header
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.buffer.subarray(0, headerEnd).toString();
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Skip malformed header
          this.buffer = this.buffer.subarray(headerEnd + 4);
          continue;
        }
        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.subarray(headerEnd + 4);
      }

      if (this.buffer.length < this.contentLength) return;

      const body = this.buffer.subarray(0, this.contentLength).toString();
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = -1;

      try {
        const msg = JSON.parse(body);
        if ("id" in msg && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.error) {
            p.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        } else if ("id" in msg && "method" in msg) {
          // Server-to-client request — must respond to avoid server hangs
          this.emit("log", `Server request: ${msg.method} (id=${msg.id})`);
          let result: any = null;
          if (msg.method === "workspace/configuration" && Array.isArray(msg.params?.items)) {
            result = msg.params.items.map(() => null);
          }
          this.send({ jsonrpc: "2.0", id: msg.id, result });
        }
        // Server-to-client notifications (method but no id) are silently ignored
      } catch {
        // Malformed JSON, skip
      }
    }
  }
}
