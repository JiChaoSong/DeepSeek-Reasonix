// /feishu 斜杠命令处理器

import { t } from "../../../../i18n/index.js";
import type { SlashHandler } from "../dispatch.js";

export const handlers: Record<string, SlashHandler> = {
  feishu(args, _loop, ctx) {
    const subcommand = (args[0] ?? "status").toLowerCase();
    const feishuCtx = ctx.feishu;

    if (!feishuCtx && subcommand !== "connect") {
      return { info: t("handlers.feishu.unavailable") };
    }

    if (subcommand === "connect") {
      ctx.postInfo?.(t("handlers.feishu.connecting"));
      if (feishuCtx) {
        void feishuCtx.connect(args.slice(1)).then(
          (msg) => ctx.postInfo?.(msg),
          (err) =>
            ctx.postInfo?.(t("handlers.feishu.connectFailed", { reason: (err as Error).message })),
        );
      } else {
        ctx.postInfo?.(
          t("handlers.feishu.connectFailed", { reason: "not available in this session" }),
        );
      }
      return {};
    }

    if (subcommand === "disconnect") {
      ctx.postInfo?.(t("handlers.feishu.disconnecting"));
      void feishuCtx!.disconnect().then(
        (msg) => ctx.postInfo?.(msg),
        (err) =>
          ctx.postInfo?.(t("handlers.feishu.disconnectFailed", { reason: (err as Error).message })),
      );
      return {};
    }

    if (subcommand === "status") {
      return { info: feishuCtx!.status() };
    }

    return { info: t("handlers.feishu.usage") };
  },
};
