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
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buffer = Buffer.alloc(0);
  private contentLength = -1;
  private openDocuments = new Set<string>();
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
        p.reject(new Error(`LSP server exited with code ${code}`));
      }
      this.pending.clear();
      this.initialized = false;
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
    } catch {
      // Best effort
    }
    this.proc.kill();
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
  async ensureOpen(filePath: string, content: string, languageId: string): Promise<void> {
    const uri = `file://${filePath}`;
    if (this.openDocuments.has(uri)) return;
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    });
    this.openDocuments.add(uri);
  }

  /**
   * Close and reopen a document to refresh the server's view after edits.
   * No-op if the document was never opened.
   */
  async refreshDocument(filePath: string, content: string, languageId: string): Promise<void> {
    const uri = `file://${filePath}`;
    if (!this.openDocuments.has(uri)) return;
    this.notify("textDocument/didClose", { textDocument: { uri } });
    this.openDocuments.delete(uri);
    await this.ensureOpen(filePath, content, languageId);
  }

  async hover(filePath: string, line: number, col: number): Promise<any> {
    return this.request("textDocument/hover", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
    });
  }

  async definition(filePath: string, line: number, col: number): Promise<any> {
    return this.request("textDocument/definition", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
    });
  }

  async references(filePath: string, line: number, col: number, includeDeclaration = true): Promise<any> {
    return this.request("textDocument/references", {
      textDocument: { uri: `file://${filePath}` },
      position: { line, character: col },
      context: { includeDeclaration },
    });
  }

  async documentSymbol(filePath: string): Promise<any> {
    return this.request("textDocument/documentSymbol", {
      textDocument: { uri: `file://${filePath}` },
    });
  }

  async workspaceSymbol(query: string): Promise<any> {
    return this.request("workspace/symbol", { query });
  }

  // --- JSON-RPC transport ---

  private request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        return reject(new Error("LSP server not running"));
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request '${method}' timed out after 30s`));
        }
      }, 30000);
    });
  }

  private notify(method: string, params: any): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(msg: any): void {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.proc!.stdin!.write(header + body);
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
          if (msg.error) {
            p.reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            p.resolve(msg.result);
          }
        }
        // Notifications and server-initiated requests are ignored for now
      } catch {
        // Malformed JSON, skip
      }
    }
  }
}
