import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * AWS SSO auto-login extension.
 *
 * Checks SSO session validity on startup and before each prompt.
 * If expired, runs the configured login command.
 * Use /aws-sso to manually trigger login.
 *
 * Config: ~/.config/pi/agent/aws-sso.json
 * {
 *   "checkCommand": "aws sts get-caller-identity",
 *   "loginCommand": "aws sso login",
 *   "checkOnStartup": true,
 *   "checkBeforePrompt": true,
 *   "enabled": true
 * }
 *
 * Set "enabled": false to make this a noop (e.g., on machines not using AWS).
 * If the config file doesn't exist, the extension is disabled.
 */

interface AwsSsoConfig {
  /** Enable the extension. Default: true (but missing config file = disabled) */
  enabled?: boolean;
  /** Command to check if SSO session is valid. Default: "aws sts get-caller-identity" */
  checkCommand?: string;
  /** Command to login. Default: "aws sso login" */
  loginCommand?: string;
  /** Check SSO status on startup. Default: true */
  checkOnStartup?: boolean;
  /** Check SSO status before each prompt. Default: true */
  checkBeforePrompt?: boolean;
}

const CONFIG_PATH = path.join(os.homedir(), ".config", "pi", "agent", "aws-sso.json");

const SSO_ERROR_PATTERNS = [
  "Token is expired",
  "The SSO session associated with this profile has expired",
  "Error when retrieving token from sso",
  "SSO Token has expired",
  "UnauthorizedSSOTokenException",
  "Token has expired and refresh failed",
  "expired",
];

function loadConfig(): AwsSsoConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function matchesSsoError(text: string): boolean {
  return SSO_ERROR_PATTERNS.some((p) => text.toLowerCase().includes(p.toLowerCase()));
}

function splitCommand(cmd: string): [string, string[]] {
  const parts = cmd.split(/\s+/);
  return [parts[0], parts.slice(1)];
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // No config file or explicitly disabled → noop
  if (!config || config.enabled === false) return;

  const checkCmd = config.checkCommand ?? "aws sts get-caller-identity";
  const loginCmd = config.loginCommand ?? "aws sso login";
  const checkOnStartup = config.checkOnStartup ?? true;
  const checkBeforePrompt = config.checkBeforePrompt ?? true;

  let loginInProgress = false;
  let sessionValid = false;

  const WIDGET_ID = "aws-sso";
  const MAX_WIDGET_LINES = 15;

  async function runLogin(ctx: ExtensionContext): Promise<boolean> {
    if (loginInProgress) return false;
    loginInProgress = true;

    const lines: string[] = [`$ ${loginCmd}`, ""];
    const updateWidget = () => {
      const visible = lines.slice(-MAX_WIDGET_LINES);
      ctx.ui.setWidget(WIDGET_ID, visible);
    };

    try {
      updateWidget();
      const [cmd, args] = splitCommand(loginCmd);
      const code = await new Promise<number>((resolve) => {
        const proc = spawn(cmd, args, {
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        const onData = (chunk: Buffer) => {
          const text = chunk.toString();
          for (const line of text.split("\n")) {
            if (line) lines.push(line);
          }
          updateWidget();
        };

        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("close", (exitCode) => resolve(exitCode ?? 1));
        proc.on("error", () => resolve(1));

        // 120s timeout
        setTimeout(() => {
          proc.kill();
          lines.push("[timeout — killed after 120s]");
          updateWidget();
        }, 120_000);
      });

      if (code === 0) {
        sessionValid = true;
        ctx.ui.notify("AWS SSO login succeeded ✓", "info");
        return true;
      } else {
        ctx.ui.notify(`AWS SSO login failed (exit ${code})`, "error");
        return false;
      }
    } finally {
      loginInProgress = false;
      ctx.ui.setWidget(WIDGET_ID, undefined);
    }
  }

  async function checkAndLogin(ctx: ExtensionContext): Promise<void> {
    if (loginInProgress) return;

    const [cmd, args] = splitCommand(checkCmd);
    const result = await pi.exec(cmd, args, { timeout: 10_000 });

    if (result.code === 0) {
      sessionValid = true;
      return;
    }

    if (!matchesSsoError(result.stderr + result.stdout)) {
      ctx.ui.notify(`AWS check failed (not an SSO error): ${result.stderr.slice(0, 150)}`, "warning");
      return;
    }

    ctx.ui.notify("AWS SSO session expired — logging in...", "warning");
    await runLogin(ctx);
  }

  // /aws-sso command — manual login trigger
  pi.registerCommand("aws-sso", {
    description: "Run AWS SSO login",
    handler: async (_args, ctx) => {
      await runLogin(ctx);
    },
  });

  if (checkOnStartup) {
    pi.on("session_start", async (_event, ctx) => {
      await checkAndLogin(ctx);
    });
  }

  if (checkBeforePrompt) {
    pi.on("before_agent_start", async (_event, ctx) => {
      if (!sessionValid) {
        await checkAndLogin(ctx);
      }
    });
  }
}