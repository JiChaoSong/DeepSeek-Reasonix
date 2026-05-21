// FeishuChannel — 飞书远程通道。实现 RemoteChannel 接口。

import { loadFeishuConfig } from "../config.js";
import type { ChannelStatus, RemoteChannel } from "../remote/types.js";
import { FeishuBot, type FeishuMessageEvent } from "./bot.js";

export class FeishuChannel implements RemoteChannel {
  readonly platform = "feishu";
  private bot: FeishuBot | null = null;
  private feishuUserId: string | null = null;
  /** 用户最新一条消息的 ID，用于 reply 回复 */
  private lastUserMessageId: string | null = null;
  private connectionStatus: ChannelStatus = { kind: "disconnected" };
  private processedMsgIds = new Set<string>();
  private processedMsgIdQueue: string[] = [];

  constructor(
    private callbacks: {
      onSubmitMessage: (text: string) => void;
      onError?: (msg: string) => void;
    },
  ) {}

  getStatus(): ChannelStatus {
    return this.connectionStatus;
  }

  describeAccess(): string {
    return "open";
  }

  refreshConfig(): void {}

  private setStatus(status: ChannelStatus): void {
    this.connectionStatus = status;
  }

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

  private handleMessageEvent(event: FeishuMessageEvent): void {
    const contentText = event.message.content?.trim();
    if (!contentText) return;
    if (!this.rememberMessage(event.message.message_id)) return;
    this.feishuUserId = event.sender.sender_id.open_id;
    this.lastUserMessageId = event.message.message_id;

    // 立即添加 👍 反应表示"已收到"
    this.bot?.addReaction(event.message.message_id);
    // 转发给 Reasonix
    this.callbacks.onSubmitMessage(`[Feishu] ${contentText}`);
  }

  async start(): Promise<void> {
    this.setStatus({ kind: "connecting" });
    const config = loadFeishuConfig();
    if (!config.appId) throw new Error("Feishu App ID is required");
    if (!config.appSecret) throw new Error("Feishu App Secret is required");

    const bot = new FeishuBot({
      appId: config.appId,
      appSecret: config.appSecret,
    });

    bot.on("message.receive", (event: FeishuMessageEvent) => {
      this.handleMessageEvent(event);
    });

    this.bot = bot;
    await bot.start();
    this.setStatus({ kind: "connected" });
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
    this.bot = null;
    this.setStatus({ kind: "disconnected" });
  }

  async sendResponse(text: string): Promise<void> {
    if (!this.bot || !this.feishuUserId) return;

    // 使用 im.v1.message.reply 回复用户最新一条消息
    const replyTo = this.lastUserMessageId;
    if (replyTo) {
      try {
        await this.bot.replyCard(this.feishuUserId, replyTo, text);
      } catch (err) {
        this.callbacks.onError?.(`Feishu replyCard failed: ${(err as Error).message}`);
      }
      return;
    }

    // fallback：无消息 ID 时直接发送（不应发生）
    try {
      await this.bot.replyCard(this.feishuUserId, "0", text);
    } catch (err) {
      this.callbacks.onError?.(`Feishu sendResponse fallback failed: ${(err as Error).message}`);
    }
  }
}
