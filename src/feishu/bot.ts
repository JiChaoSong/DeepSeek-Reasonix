// FeishuBot — 飞书 Bot，基于 @larksuiteoapi/node-sdk 的 LarkChannel（WebSocket 长连）。

import { EventEmitter } from "node:events";
import * as lark from "@larksuiteoapi/node-sdk";

export interface FeishuMessageEvent {
  sender: { sender_id: { open_id: string } };
  message: { message_id: string; content: string; message_type: string };
}

interface FeishuBotConfig {
  appId: string;
  appSecret: string;
}

// 构建飞书卡片消息
function buildCard(text: string): string {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🤖 Reasonix" },
      template: "blue",
    },
    elements: [
      {
        tag: "markdown",
        content: text,
      },
      {
        tag: "hr",
      },
      {
        tag: "note",
        elements: [{ tag: "plain_text", content: "Powered by Reasonix · DeepSeek" }],
      },
    ],
  };
  return JSON.stringify(card);
}

export class FeishuBot extends EventEmitter {
  private channel: lark.LarkChannel | null = null;

  constructor(private config: FeishuBotConfig) {
    super();
  }

  async start(): Promise<void> {
    this.channel = new lark.LarkChannel({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      transport: "websocket",
    });

    this.channel.on("message", (msg: lark.NormalizedMessage) => {
      if (msg.chatType !== "p2p") return;
      if (msg.rawContentType !== "text") return;

      this.emit("message.receive", {
        sender: { sender_id: { open_id: msg.senderId } },
        message: {
          message_id: msg.messageId,
          content: msg.content,
          message_type: "text",
        },
      } satisfies FeishuMessageEvent);
    });

    await this.channel.connect();
    this.emit("online");
  }

  async stop(): Promise<void> {
    try {
      await this.channel?.disconnect();
    } catch {
      // ignore
    }
    this.channel = null;
  }

  // 对指定消息添加 👍 表情回复
  async addReaction(messageId: string, emojiType = "Typing"): Promise<void> {
    if (!this.channel) return;
    try {
      await this.channel.rawClient.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      });
    } catch (err) {
      console.error(
        `[FeishuBot] addReaction failed, may need im:message permission: ${(err as Error).message}`,
      );
    }
  }

  // 以卡片形式回复指定消息
  // 使用 POST /open-apis/im/v1/messages/{message_id}/reply
  // msg_type = "interactive", content = card JSON
  async replyCard(openId: string, replyToMessageId: string, text: string): Promise<void> {
    if (!this.channel) throw new Error("Feishu bot not started");
    // 复用 LarkChannel 内部的 HTTP 客户端发送卡片回复
    const token = await this.getToken();
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(replyToMessageId)}/reply`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        msg_type: "interactive",
        content: buildCard(text),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Feishu replyCard failed (${res.status}): ${body}`);
    }
  }

  // 从 LarkChannel 底层 Client 获取 tenant_access_token
  private async getToken(): Promise<string> {
    const resp = (await this.channel!.rawClient.auth.v3.tenantAccessToken.internal({
      data: { app_id: this.config.appId, app_secret: this.config.appSecret },
    })) as { tenant_access_token?: string; code?: number; msg?: string };
    if (!resp.tenant_access_token) {
      throw new Error(`getToken failed: code=${resp.code} msg=${resp.msg}`);
    }
    return resp.tenant_access_token;
  }
}
