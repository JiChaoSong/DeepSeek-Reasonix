import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { loadQQConfig } from "../config.js";
import { loadDotenv } from "../env.js";
import { t } from "../i18n/index.js";
import { splitMessage } from "../remote/split.js";
import type { ChannelStatus, RemoteChannel, RemoteChannelCallbacks } from "../remote/types.js";
import { decideQQAccess, describeQQAccess, redactQQOpenId } from "./access.js";
import { type C2CMessage, QQBot } from "./bot.js";
import { formatQQAccessSummary } from "./strings.js";

const QQ_LOCK_FILE = join(homedir(), ".reasonix", "qq-channel.pid");
const QQ_MAX_CHUNK_BYTES = 1500;

export function splitQQMessage(text: string, maxBytes = QQ_MAX_CHUNK_BYTES): string[] {
  return splitMessage(text, maxBytes);
}

export class QQChannel implements RemoteChannel {
  private bot: QQBot | null = null;
  private qqUserId: string | null = null;
  private qqMessageId: string | null = null;
  private ownerOpenId: string | undefined;
  private allowlist: string[] | undefined;
  private runtimeBoundOpenId: string | null = null;
  private processedMsgIds = new Set<string>();
  private processedMsgIdQueue: string[] = [];
  private lockAcquired = false;
  private nextOutboundMsgSeq = 1;

  readonly platform = "qq";
  private connectionStatus: ChannelStatus = { kind: "disconnected" };

  constructor(
    private callbacks: RemoteChannelCallbacks & {
      onSubmitMessage: (text: string) => void;
    },
  ) {}

  private rememberMessage(id: string): boolean {
    if (this.processedMsgIds.has(id)) return false;
    this.processedMsgIds.add(id);
    this.processedMsgIdQueue.push(id);
    if (this.processedMsgIdQueue.length > 200) {
      const oldest = this.processedMsgIdQueue.shift();
      if (oldest) this.processedMsgIds.delete(oldest);
    }
    return true;
  }

  private acquireLock(): void {
    try {
      const existing = Number(readFileSync(QQ_LOCK_FILE, "utf8").trim());
      if (Number.isInteger(existing) && existing > 0 && existing !== process.pid) {
        try {
          process.kill(existing, 0);
          throw new Error(t("handlers.qq.lockAlreadyRunning", { pid: existing }));
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code !== "ESRCH") throw err;
        }
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }

    mkdirSync(dirname(QQ_LOCK_FILE), { recursive: true });
    writeFileSync(QQ_LOCK_FILE, String(process.pid), "utf8");
    this.lockAcquired = true;
  }

  private releaseLock(): void {
    if (!this.lockAcquired) return;
    try {
      const existing = Number(readFileSync(QQ_LOCK_FILE, "utf8").trim());
      if (existing === process.pid) unlinkSync(QQ_LOCK_FILE);
    } catch {}
    this.lockAcquired = false;
  }

  private applyAccessConfig(config: ReturnType<typeof loadQQConfig>): void {
    this.ownerOpenId = config.ownerOpenId;
    this.allowlist = config.allowlist;
    if (this.ownerOpenId || (this.allowlist?.length ?? 0) > 0) {
      this.runtimeBoundOpenId = null;
    }
  }

  getStatus(): ChannelStatus {
    return this.connectionStatus;
  }

  private setStatus(status: ChannelStatus): void {
    this.connectionStatus = status;
    this.callbacks.onStatusChange?.(status);
  }

  private handlePrivateMessage(msg: C2CMessage): void {
    const text = msg.content?.trim();
    if (!text) return;
    if (!this.rememberMessage(msg.id)) return;

    const openid = msg.author.user_openid;
    const verdict = decideQQAccess(
      {
        ownerOpenId: this.ownerOpenId,
        allowlist: this.allowlist,
        runtimeBoundOpenId: this.runtimeBoundOpenId,
      },
      openid,
    );
    if (!verdict.accept) {
      this.callbacks.onError?.(
        t("handlers.qq.unauthorizedMessage", {
          openid: redactQQOpenId(openid),
          access: formatQQAccessSummary({
            ownerOpenId: this.ownerOpenId,
            allowlist: this.allowlist,
            runtimeBoundOpenId: this.runtimeBoundOpenId,
          }),
        }),
      );
      return;
    }
    if (verdict.bindRuntime) {
      this.runtimeBoundOpenId = openid;
      this.callbacks.onError?.(
        t("handlers.qq.runtimeBound", {
          openid: redactQQOpenId(openid),
        }),
      );
    }

    this.qqUserId = openid;
    this.qqMessageId = msg.id;
    this.callbacks.onSubmitMessage(`[QQ] ${text}`);
  }

  refreshAccessConfig(): void {
    this.applyAccessConfig(loadQQConfig());
  }

  refreshConfig(): void {
    this.refreshAccessConfig();
  }

  describeAccess(): string {
    return describeQQAccess({
      ownerOpenId: this.ownerOpenId,
      allowlist: this.allowlist,
      runtimeBoundOpenId: this.runtimeBoundOpenId,
    });
  }

  getRuntimeBoundOpenId(): string | null {
    return this.runtimeBoundOpenId;
  }

  async start(): Promise<void> {
    this.setStatus({ kind: "connecting" });
    loadDotenv();
    this.acquireLock();

    const config = loadQQConfig();
    if (!config.appId) {
      this.releaseLock();
      throw new Error(t("handlers.qq.missingAppId"));
    }
    if (!config.appSecret) {
      this.releaseLock();
      throw new Error(t("handlers.qq.missingAppSecret"));
    }
    this.applyAccessConfig(config);

    const bot = new QQBot({
      appid: config.appId,
      secret: config.appSecret,
      sandbox: config.sandbox ?? false,
    });

    bot.on("online", () => {
      process.stderr.write("QQ bot is online!\n");
    });

    bot.on("bot_error", (msg: string) => {
      this.callbacks.onError?.(msg);
    });

    bot.on("message.private", (msg: C2CMessage) => {
      this.handlePrivateMessage(msg);
    });

    this.bot = bot;

    try {
      await bot.start();

      const readyOrError = await Promise.race([
        new Promise<"ready">((resolve) => bot.once("online", () => resolve("ready"))),
        new Promise<"error">((resolve) => bot.once("bot_error", () => resolve("error"))),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
      ]);

      if (readyOrError === "error") {
        throw new Error(t("handlers.qq.authFailed"));
      }
      if (readyOrError === "timeout") {
        throw new Error(t("handlers.qq.readyTimeout"));
      }
      this.setStatus({ kind: "connected" });
    } catch (err) {
      this.releaseLock();
      this.setStatus({ kind: "failed", error: (err as Error).message });
      throw err;
    }
  }

  async sendResponse(text: string): Promise<void> {
    if (!this.bot || !this.qqUserId) return;
    const chunks = splitQQMessage(text);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      if (!chunk) continue;
      try {
        await this.bot.sendPrivateMessage(
          this.qqUserId,
          chunk,
          this.qqMessageId ?? undefined,
          this.nextOutboundMsgSeq++,
        );
      } catch (err) {
        const msg = `QQ sendResponse chunk ${index + 1}/${chunks.length} failed: ${(err as Error).message}`;
        this.callbacks.onError?.(msg);
        break;
      }
    }
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
    this.releaseLock();
    this.setStatus({ kind: "disconnected" });
  }
}
