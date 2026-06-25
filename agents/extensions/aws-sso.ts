/**
 * AWS SSO preflight for Pi's Amazon Bedrock provider.
 *
 * Runs `aws sts get-caller-identity` and, only when that fails, `aws sso login`
 * for profile-based Bedrock auth. This exists mainly for GUI/RPC hosts such as
 * Pilot, where shell env from fish/zsh is not inherited but Pi provider-scoped
 * auth env from auth.json is available via the model registry.
 *
 * What counts as "Bedrock configured": Pi's active model (or, at startup, any
 * registered model) has provider `amazon-bedrock` and Pi's model registry says
 * auth is configured. The extension then resolves provider-scoped env through
 * `getApiKeyAndHeaders()` and uses AWS_PROFILE from that env/process.
 *
 * It intentionally does NOT run SSO for raw AWS key env, Bedrock bearer token,
 * ECS/IRSA, or AWS_BEDROCK_SKIP_AUTH flows. Those are not SSO profiles, and
 * running `aws sso login` would be noisy or wrong.
 *
 * Optional config file (all fields optional):
 *   $PI_AWS_SSO_CONFIG, else ~/.pi/agent/aws-sso.json, else
 *   ~/.config/pi/agent/aws-sso.json
 *
 * {
 *   "enabled": true,
 *   "runOnStartup": true,
 *   "runBeforeBedrockRequest": true,
 *   "minCheckIntervalMs": 60000,
 *   "failureBackoffMs": 60000,
 *   "commandTimeoutMs": 300000,
 *   "awsExecutable": "aws",
 *   "profile": "bedrock",
 *   "ssoSession": "my-sso-session",
 *   "notify": true
 * }
 *
 * `profile` overrides AWS_PROFILE/AWS_DEFAULT_PROFILE for the spawned commands.
 * `ssoSession`, when set, uses `aws sso login --sso-session ...`; otherwise the
 * login uses `aws sso login --profile ...`.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BEDROCK_PROVIDER = "amazon-bedrock";
const STATUS_KEY = "aws-sso";
const WIDGET_KEY = "aws-sso-login";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LOGIN_INDICATOR_TICK_MS = 1_000;
const DEFAULT_MIN_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_FAILURE_BACKOFF_MS = 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;

const AWS_CREDENTIAL_ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_ROLE_SESSION_NAME",
] as const;

const AWS_CLI_BASE_ENV_KEYS = [
  "HOME",
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "BROWSER",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
] as const;

const AWS_CLI_CONFIG_ENV_KEYS = [
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_CA_BUNDLE",
  "AWS_PAGER",
  "AWS_CLI_AUTO_PROMPT",
  "AWS_STS_REGIONAL_ENDPOINTS",
  "AWS_RETRY_MODE",
  "AWS_MAX_ATTEMPTS",
  "AWS_EC2_METADATA_DISABLED",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

interface AwsSsoConfig {
  enabled?: boolean;
  runOnStartup?: boolean;
  runBeforeBedrockRequest?: boolean;
  minCheckIntervalMs?: number;
  failureBackoffMs?: number;
  commandTimeoutMs?: number;
  awsExecutable?: string;
  profile?: string;
  ssoSession?: string;
  notify?: boolean;
}

interface LoadedConfig {
  config: Required<
    Pick<
      AwsSsoConfig,
      | "enabled"
      | "runOnStartup"
      | "runBeforeBedrockRequest"
      | "minCheckIntervalMs"
      | "failureBackoffMs"
      | "commandTimeoutMs"
      | "awsExecutable"
      | "notify"
    >
  > &
    Pick<AwsSsoConfig, "profile" | "ssoSession">;
  path?: string;
  error?: string;
}

interface BedrockSsoTarget {
  model: Model<any>;
  env: NodeJS.ProcessEnv;
  profile: string;
  ssoSession?: string;
}

interface CommandResult {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  error?: string;
}

export default function awsSsoExtension(pi: ExtensionAPI) {
  const loaded = loadConfig();
  const cfg = loaded.config;

  let configErrorNotified = false;
  let skippedNonProfileNotified = false;
  let missingAwsNotified = false;
  const lastSuccessAt = new Map<string, number>();
  const lastFailureAt = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();

  const maybeNotifyConfigError = (ctx: ExtensionContext) => {
    if (!loaded.error || configErrorNotified) return;
    configErrorNotified = true;
    ctx.ui.notify(`[aws-sso] ${loaded.error}; extension disabled`, "error");
  };

  const ensure = async (
    ctx: ExtensionContext,
    reason: "startup" | "model_select" | "provider_request",
    activeOnly: boolean,
    primaryModel?: Model<any>,
  ) => {
    maybeNotifyConfigError(ctx);
    if (loaded.error || !cfg.enabled || process.env.PI_AWS_SSO_DISABLED === "1")
      return;
    if (reason === "provider_request" && !cfg.runBeforeBedrockRequest) return;
    if (reason === "startup" && !cfg.runOnStartup) return;

    const targets = await resolveBedrockSsoTargets(
      ctx,
      cfg,
      activeOnly,
      primaryModel,
    );
    for (const target of targets) await ensureTarget(ctx, target);
  };

  const ensureTarget = async (
    ctx: ExtensionContext,
    target: BedrockSsoTarget,
  ) => {
    const stateKey = targetStateKey(target);
    const now = Date.now();
    const lastSuccess = lastSuccessAt.get(stateKey) ?? 0;
    const lastFailure = lastFailureAt.get(stateKey) ?? 0;
    if (lastSuccess && now - lastSuccess < cfg.minCheckIntervalMs) return;
    if (lastFailure && now - lastFailure < cfg.failureBackoffMs) return;

    const existing = inFlight.get(stateKey);
    if (existing) {
      await existing;
      return;
    }

    const current = (async () => {
      ctx.ui.setStatus(STATUS_KEY, "checking AWS SSO…");
      try {
        const check = await runAws(
          cfg.awsExecutable,
          stsArgs(target.profile),
          target.env,
          cfg.commandTimeoutMs,
          ctx.signal,
        );
        if (check.ok) {
          lastSuccessAt.set(stateKey, Date.now());
          return;
        }

        if (process.env.PI_AWS_SSO_DRY_RUN === "1") {
          if (cfg.notify)
            ctx.ui.notify(
              "[aws-sso] dry run: would run aws sso login",
              "warning",
            );
          lastFailureAt.set(stateKey, Date.now());
          return;
        }

        if (check.error && /ENOENT/.test(check.error)) {
          lastFailureAt.set(stateKey, Date.now());
          if (!missingAwsNotified) {
            missingAwsNotified = true;
            ctx.ui.notify(
              `[aws-sso] could not execute ${cfg.awsExecutable}; is AWS CLI installed/in PATH?`,
              "error",
            );
          }
          return;
        }

        if (cfg.notify)
          ctx.ui.notify(
            "[aws-sso] AWS SSO expired; launching login",
            "warning",
          );

        const stopLoginIndicator = startLoginIndicator(ctx, target.profile);
        let login: CommandResult;
        try {
          login = await runAws(
            cfg.awsExecutable,
            loginArgs(target),
            target.env,
            cfg.commandTimeoutMs,
            ctx.signal,
          );
        } finally {
          stopLoginIndicator();
        }
        if (!login.ok) {
          lastFailureAt.set(stateKey, Date.now());
          ctx.ui.notify(
            `[aws-sso] aws sso login failed (${formatCommandFailure(login)})`,
            "error",
          );
          return;
        }

        ctx.ui.setStatus(STATUS_KEY, "verifying AWS SSO…");
        const verify = await runAws(
          cfg.awsExecutable,
          stsArgs(target.profile),
          target.env,
          cfg.commandTimeoutMs,
          ctx.signal,
        );
        if (!verify.ok) {
          lastFailureAt.set(stateKey, Date.now());
          ctx.ui.notify(
            `[aws-sso] login completed but sts check still failed (${formatCommandFailure(verify)})`,
            "error",
          );
          return;
        }

        lastSuccessAt.set(stateKey, Date.now());
        if (cfg.notify)
          ctx.ui.notify("[aws-sso] AWS SSO ready for Bedrock", "info");
      } finally {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        ctx.ui.setWidget(WIDGET_KEY, undefined);
        inFlight.delete(stateKey);
      }
    })();

    inFlight.set(stateKey, current);
    await current;
  };

  pi.on("session_start", async (_event, ctx) => {
    await ensure(ctx, "startup", false);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.model.provider !== BEDROCK_PROVIDER) return;
    await ensure(ctx, "model_select", true, event.model);
  });

  pi.on("before_provider_request", async (_event, ctx) => {
    if (ctx.model?.provider !== BEDROCK_PROVIDER) return;
    await ensure(ctx, "provider_request", true);
  });

  async function resolveBedrockSsoTargets(
    ctx: ExtensionContext,
    config: LoadedConfig["config"],
    activeOnly: boolean,
    primaryModel?: Model<any>,
  ): Promise<BedrockSsoTarget[]> {
    const targets: BedrockSsoTarget[] = [];
    const candidates = bedrockCandidates(ctx, activeOnly, primaryModel);

    for (const model of candidates) {
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) continue;

      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) continue;

      const providerEnv: NodeJS.ProcessEnv = auth.env ?? {};
      if (providerEnv.AWS_BEDROCK_SKIP_AUTH === "1") continue;
      if (isNonProfileBedrockAuth(providerEnv)) {
        if (!skippedNonProfileNotified && config.notify) {
          skippedNonProfileNotified = true;
          ctx.ui.notify(
            "[aws-sso] Bedrock uses provider-scoped non-profile AWS auth; SSO preflight skipped",
            "info",
          );
        }
        continue;
      }

      const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...providerEnv };
      if (mergedEnv.AWS_BEDROCK_SKIP_AUTH === "1") continue;
      if (
        isNonProfileBedrockAuth(mergedEnv) &&
        !hasProfile(config, mergedEnv)
      ) {
        if (!skippedNonProfileNotified && config.notify) {
          skippedNonProfileNotified = true;
          ctx.ui.notify(
            "[aws-sso] Bedrock uses non-profile AWS auth; SSO preflight skipped",
            "info",
          );
        }
        continue;
      }

      const profile =
        config.profile ??
        providerEnv.AWS_PROFILE ??
        providerEnv.AWS_DEFAULT_PROFILE ??
        process.env.AWS_PROFILE ??
        process.env.AWS_DEFAULT_PROFILE;
      if (!profile) continue;

      targets.push({
        model,
        env: buildAwsCliEnv(providerEnv, profile),
        profile,
        ssoSession: config.ssoSession,
      });
    }

    return targets;
  }
}

function startLoginIndicator(
  ctx: ExtensionContext,
  profile: string,
): () => void {
  const startedAt = Date.now();
  let frame = 0;

  const render = () => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    frame += 1;
    const line = `${spinner} aws sso login (${profile}) — finish the browser sign-in… ${elapsedSec}s`;
    // setStatus drives the interactive footer; setWidget gives a persistent
    // visible row that also survives RPC hosts (e.g. Pilot), where the
    // streaming working-indicator APIs are no-ops.
    ctx.ui.setStatus(STATUS_KEY, line);
    ctx.ui.setWidget(WIDGET_KEY, [line]);
  };

  render();
  const handle = setInterval(render, LOGIN_INDICATOR_TICK_MS);
  // Don't let the ticking indicator keep the process alive on its own.
  handle.unref?.();

  return () => {
    clearInterval(handle);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  };
}

function loadConfig(): LoadedConfig {
  const path = configPath();
  let raw: AwsSsoConfig = {};

  if (path) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8")) as AwsSsoConfig;
    } catch (error) {
      return {
        config: defaults({ enabled: false }),
        path,
        error: `failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { config: defaults(raw), path };
}

function configPath(): string | undefined {
  const explicit = process.env.PI_AWS_SSO_CONFIG;
  if (explicit) return explicit;

  const candidates = [
    join(homedir(), ".pi", "agent", "aws-sso.json"),
    join(homedir(), ".config", "pi", "agent", "aws-sso.json"),
  ];
  return candidates.find((p) => existsSync(p));
}

function defaults(config: AwsSsoConfig): LoadedConfig["config"] {
  return {
    enabled: config.enabled ?? true,
    runOnStartup: config.runOnStartup ?? true,
    runBeforeBedrockRequest: config.runBeforeBedrockRequest ?? true,
    minCheckIntervalMs: finiteNumber(
      config.minCheckIntervalMs,
      DEFAULT_MIN_CHECK_INTERVAL_MS,
    ),
    failureBackoffMs: finiteNumber(
      config.failureBackoffMs,
      DEFAULT_FAILURE_BACKOFF_MS,
    ),
    commandTimeoutMs: finiteNumber(
      config.commandTimeoutMs,
      DEFAULT_COMMAND_TIMEOUT_MS,
    ),
    awsExecutable: config.awsExecutable ?? "aws",
    profile: config.profile,
    ssoSession: config.ssoSession,
    notify: config.notify ?? true,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function bedrockCandidates(
  ctx: ExtensionContext,
  activeOnly: boolean,
  primaryModel?: Model<any>,
): Model<any>[] {
  const out: Model<any>[] = [];
  const seen = new Set<string>();
  const add = (model: Model<any> | undefined) => {
    if (!model || model.provider !== BEDROCK_PROVIDER) return;
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(model);
  };

  add(primaryModel);
  if (!primaryModel || !activeOnly) add(ctx.model);
  if (!activeOnly) {
    for (const model of ctx.modelRegistry.getAll()) add(model as Model<any>);
  }
  return out;
}

function hasProfile(
  config: LoadedConfig["config"],
  env: NodeJS.ProcessEnv,
): boolean {
  return Boolean(config.profile ?? env.AWS_PROFILE ?? env.AWS_DEFAULT_PROFILE);
}

function isNonProfileBedrockAuth(env: NodeJS.ProcessEnv): boolean {
  if (env.AWS_BEARER_TOKEN_BEDROCK) return true;
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return true;
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) return true;
  if (env.AWS_CONTAINER_CREDENTIALS_FULL_URI) return true;
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE) return true;
  return false;
}

function buildAwsCliEnv(
  providerEnv: NodeJS.ProcessEnv,
  profile: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  copyAllowedEnv(env, process.env, AWS_CLI_BASE_ENV_KEYS);
  copyAllowedEnv(env, process.env, AWS_CLI_CONFIG_ENV_KEYS);
  copyAllowedEnv(env, providerEnv, AWS_CLI_CONFIG_ENV_KEYS);

  env.AWS_PROFILE = profile;
  // Keep command output out of pagers in non-terminal hosts like Pilot.
  env.AWS_PAGER = "";

  // Defense-in-depth: these keys are intentionally excluded by the allowlists
  // above, but delete them if a future allowlist edit accidentally adds one.
  for (const key of AWS_CREDENTIAL_ENV_KEYS) delete env[key];
  return env;
}

function copyAllowedEnv(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) target[key] = value;
  }
}

function stsArgs(profile: string): string[] {
  return ["sts", "get-caller-identity", "--profile", profile];
}

function loginArgs(target: BedrockSsoTarget): string[] {
  if (target.ssoSession)
    return ["sso", "login", "--sso-session", target.ssoSession];
  return ["sso", "login", "--profile", target.profile];
}

function targetStateKey(target: BedrockSsoTarget): string {
  return JSON.stringify({
    profile: target.profile,
    ssoSession: target.ssoSession ?? null,
    awsConfigFile: target.env.AWS_CONFIG_FILE ?? null,
    awsSharedCredentialsFile: target.env.AWS_SHARED_CREDENTIALS_FILE ?? null,
  });
}

function runAws(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: CommandResult, clearKillTimer = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (clearKillTimer && killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };

    const scheduleKill = () => {
      if (killTimer) return;
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };

    const abort = () => {
      child.kill("SIGTERM");
      scheduleKill();
      finish(
        {
          ok: false,
          code: null,
          signal: "SIGTERM",
          timedOut: false,
          error: "aborted",
        },
        false,
      );
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      scheduleKill();
    }, timeoutMs);

    // Drain output without retaining it. AWS SSO output can include device-code
    // material; statuses above report only exit shape, never stdout/stderr.
    child.stdout?.resume();
    child.stderr?.resume();

    signal?.addEventListener("abort", abort, { once: true });

    child.on("error", (error) => {
      finish({
        ok: false,
        code: null,
        signal: null,
        timedOut,
        error: error.message,
      });
    });

    child.on("close", (code, closeSignal) => {
      if (killTimer) clearTimeout(killTimer);
      finish({ ok: code === 0, code, signal: closeSignal, timedOut });
    });
  });
}

function formatCommandFailure(result: CommandResult): string {
  if (result.timedOut) return "timed out";
  if (result.error) return result.error;
  if (result.signal) return `signal ${result.signal}`;
  return `exit ${result.code ?? "unknown"}`;
}
