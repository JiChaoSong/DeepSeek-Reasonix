// useRemoteChannel — 平台无关的远程通道 React Hook。
// 管理多通道消息路由、暂停门交互、斜杠命令回复等逻辑。

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PlanConfirmChoice } from "../cli/ui/PlanConfirm.js";
import type { ReviseChoice } from "../cli/ui/PlanReviseConfirm.js";
import type { ThemeChoice } from "../cli/ui/ThemePicker.js";
import type { SlashResult } from "../cli/ui/slash/types.js";
import { listThemeNames } from "../cli/ui/theme/tokens.js";
import { type CheckpointMeta, fmtAgo, restoreCheckpoint } from "../code/checkpoints.js";
import { resolveThemePreference } from "../config.js";
import { t } from "../i18n/index.js";
import { type SessionInfo, freshSessionName } from "../memory/session.js";
import type { ChoiceOption } from "../tools/choice.js";
import type { PlanStep } from "../tools/plan.js";
import type { ChannelStatus, RemoteChannel } from "./types.js";

type InteractionKind =
  | "run_command"
  | "run_background"
  | "path_access"
  | "plan_proposed"
  | "plan_checkpoint"
  | "plan_revision"
  | "choice";

type SlashInteractionKind =
  | "sessions_picker"
  | "checkpoint_picker"
  | "model_picker"
  | "theme_picker";

interface InteractionState {
  kind: InteractionKind | null;
  payload: unknown;
}
interface SlashInteractionState {
  kind: SlashInteractionKind | null;
  payload: unknown;
}

interface RemoteLogger {
  pushInfo: (text: string) => void;
  pushWarning: (title: string, detail: string) => void;
}

export interface UseRemoteChannelArgs {
  codeMode: boolean;
  initialChannels?: RemoteChannel[];
  log: RemoteLogger;
  setQueuedSubmit: (text: string) => void;
  sessionName?: string | null;
  currentRootDir: string;
  pendingGateIdRef: { current: number | null };
  completedStepIdsRef: { current: Set<string> };
  planStepsRef: { current: PlanStep[] | null };
  onCreateSession?: (name: string) => void;
  onSelectSession?: (name: string) => void;
  onModelPick: (target: string) => string;
  onThemePick: (target: ThemeChoice) => string;
  onShellConfirmRef: { current: (choice: "run_once" | "always_allow" | "deny") => void };
  onPathConfirmRef: { current: (choice: "run_once" | "always_allow" | "deny") => void };
  onPlanCancelRef: { current: () => void | Promise<void> };
  onPlanFeedbackRef: {
    current: (
      feedback: string,
      override: { plan: string; mode: "refine" | "approve" | "reject" },
    ) => void | Promise<void>;
  };
  onCheckpointConfirmRef: { current: (choice: "continue" | "revise" | "stop") => void };
  onCheckpointReviseRef: {
    current: (feedback: string, snap: { stepId: string; title?: string }) => void;
  };
  onPlanRevisionRef: { current: (choice: ReviseChoice | "cancel") => void };
  onChoiceResolveRef: {
    current: (
      resolution:
        | { type: "pick"; optionId: string }
        | { type: "text"; text: string }
        | { type: "cancel" },
    ) => void;
  };
}

export interface RemoteSlashHandlingArgs {
  result: SlashResult;
  codeMode: boolean;
  sessions: SessionInfo[];
  checkpoints: CheckpointMeta[];
  models: string[] | null | undefined;
  restoreCodeOnlyMessage: string;
}

export interface UseRemoteChannelReturn {
  channelRefs: ReadonlyMap<string, RemoteChannel>;
  registerChannel: (channel: RemoteChannel) => void;
  unregisterChannel: (platform: string) => Promise<void>;
  sendInfo: (message: string) => void;
  sendText: (message: string) => void;
  resetInteractions: () => void;
  clearSlashInteraction: () => void;
  canBypassBusy: (queuedSubmit: string) => boolean;
  parseSubmit: (
    raw: string,
  ) => { handled: boolean; fromRemote: boolean; platform: string | undefined; text: string } | null;
  consumeSlashReply: (text: string, platform: string) => boolean;
  consumePauseReply: (text: string, platform: string) => boolean;
  noteTurnFromRemote: (fromRemote: boolean, platform?: string) => void;
  maybeSendFinalReply: (lastAssistantText: string) => void;
  clearTurnReply: () => void;
  handlePauseRequest: (kind: string, payload: Record<string, unknown>) => void;
  handleRemoteSlashResult: (args: RemoteSlashHandlingArgs) => boolean;
  beginSessionsPicker: (sessions: SessionInfo[]) => void;
  beginCheckpointPicker: (checkpoints: CheckpointMeta[]) => void;
  beginModelPicker: (models: string[]) => void;
  beginThemePicker: (themes: ThemeChoice[]) => void;
  notifyTerminalOnly: (message: string) => void;
  buildModelChoices: (models: string[] | null | undefined) => string[];
  buildThemeChoices: () => ThemeChoice[];
  getPlatformForSubmit: (text: string) => string | undefined;
}

// helpers

function parseIndexedChoice(text: string): number {
  const raw = text.match(/^(\d+)/)?.[1];
  return raw ? Number.parseInt(raw, 10) - 1 : -1;
}

function isCancelText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower === "q" || lower.includes("cancel") || lower.includes("quit");
}

function isNewText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower === "n" || lower.includes("new");
}

function parseRunPermissionChoice(text: string): "run_once" | "always_allow" | "deny" {
  const lower = text.toLowerCase();
  if (lower.includes("1") || lower.includes("run")) return "run_once";
  if (lower.includes("2") || lower.includes("always")) return "always_allow";
  return "deny";
}

function parsePlanChoice(text: string): "approve" | "refine" | "cancel" {
  const lower = text.toLowerCase();
  if (lower.includes("1") || lower.includes("approve")) return "approve";
  if (lower.includes("2") || lower.includes("refine")) return "refine";
  return "cancel";
}

function parseCheckpointChoice(text: string): "continue" | "revise" | "stop" {
  const lower = text.toLowerCase();
  if (lower.includes("1") || lower.includes("continue")) return "continue";
  if (lower.includes("2") || lower.includes("revise")) return "revise";
  return "stop";
}

function parseRevisionChoice(text: string): ReviseChoice | "cancel" {
  const lower = text.toLowerCase();
  if (lower.includes("1") || lower.includes("accept")) return "accept";
  if (lower.includes("2") || lower.includes("reject")) return "reject";
  return "cancel";
}

function stripFollowupPrefix(text: string): string {
  return text
    .replace(
      /^(?:\d+\s*|approve\s*|refine\s*|cancel\s*|continue\s*|revise\s*|stop\s*|accept\s*|reject\s*|run\s*|always\s*|deny\s*)/iu,
      "",
    )
    .trim();
}

function extractPlatform(text: string): string | undefined {
  const match = text.match(/^\[(\w+)\]\s/);
  return match?.[1]?.toLowerCase();
}

// hook

export function useRemoteChannel(args: UseRemoteChannelArgs): UseRemoteChannelReturn {
  const {
    codeMode,
    initialChannels,
    log,
    setQueuedSubmit,
    sessionName,
    currentRootDir,
    pendingGateIdRef,
    completedStepIdsRef,
    planStepsRef,
    onCreateSession,
    onSelectSession,
    onModelPick,
    onThemePick,
    onShellConfirmRef,
    onPathConfirmRef,
    onPlanCancelRef,
    onPlanFeedbackRef,
    onCheckpointConfirmRef,
    onCheckpointReviseRef,
    onPlanRevisionRef,
    onChoiceResolveRef,
  } = args;

  const channelMapRef = useRef<Map<string, RemoteChannel>>(new Map());
  const interactionRef = useRef<InteractionState>({ kind: null, payload: null });
  const slashInteractionRef = useRef<SlashInteractionState>({ kind: null, payload: null });
  const replyThisTurnRef = useRef(false);
  const replyPlatformRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialChannels) {
      for (const ch of initialChannels) {
        channelMapRef.current.set(ch.platform, ch);
      }
    }
  }, [initialChannels]);

  const registerChannel = useCallback((channel: RemoteChannel) => {
    channelMapRef.current.set(channel.platform, channel);
  }, []);

  const unregisterChannel = useCallback(async (platform: string) => {
    const ch = channelMapRef.current.get(platform);
    if (ch) {
      await ch.stop();
      channelMapRef.current.delete(platform);
    }
  }, []);

  const sendText = useCallback(
    (message: string, platform?: string) => {
      if (platform) {
        channelMapRef.current
          .get(platform)
          ?.sendResponse(message)
          .catch((err) =>
            log.pushWarning(platform!, `sendResponse error: ${(err as Error).message}`),
          );
      } else {
        for (const ch of channelMapRef.current.values()) {
          ch.sendResponse(message).catch((err) =>
            log.pushWarning(ch.platform, `sendResponse error: ${(err as Error).message}`),
          );
        }
      }
    },
    [log],
  );

  const sendInfo = useCallback(
    (message: string) => {
      log.pushInfo(message);
      sendText(message);
    },
    [log, sendText],
  );

  const resetInteractions = useCallback(() => {
    interactionRef.current = { kind: null, payload: null };
    slashInteractionRef.current = { kind: null, payload: null };
    replyThisTurnRef.current = false;
    replyPlatformRef.current = undefined;
  }, []);

  const clearSlashInteraction = useCallback(() => {
    slashInteractionRef.current = { kind: null, payload: null };
  }, []);

  const canBypassBusy = useCallback(
    (queuedSubmit: string) => {
      return (
        extractPlatform(queuedSubmit) !== undefined &&
        interactionRef.current.kind !== null &&
        pendingGateIdRef.current !== null
      );
    },
    [pendingGateIdRef],
  );

  // pickers

  const beginSessionsPicker = useCallback(
    (sessions: SessionInfo[]) => {
      slashInteractionRef.current = { kind: "sessions_picker", payload: sessions };
      const lines = sessions.map((s, idx) => `${idx + 1}. ${s.name}`);
      lines.push("N. New session", "Q. Cancel");
      sendText(`Choose a session:\n\n${lines.join("\n")}`);
    },
    [sendText],
  );

  const beginCheckpointPicker = useCallback(
    (checkpoints: CheckpointMeta[]) => {
      slashInteractionRef.current = { kind: "checkpoint_picker", payload: checkpoints };
      const lines = checkpoints.map(
        (c, idx) => `${idx + 1}. ${c.name} (${c.id.slice(0, 7)}, ${fmtAgo(c.createdAt)})`,
      );
      lines.push("Q. Cancel");
      sendText(`Choose a checkpoint to restore:\n\n${lines.join("\n")}`);
    },
    [sendText],
  );

  const beginModelPicker = useCallback(
    (models: string[]) => {
      slashInteractionRef.current = { kind: "model_picker", payload: models };
      const lines = models.map((model, idx) => `${idx + 1}. ${model}`);
      lines.push("Q. Cancel");
      sendText(`Choose a model or preset:\n\n${lines.join("\n")}`);
    },
    [sendText],
  );

  const beginThemePicker = useCallback(
    (themes: ThemeChoice[]) => {
      slashInteractionRef.current = { kind: "theme_picker", payload: themes };
      const lines = themes.map((theme, idx) => `${idx + 1}. ${theme}`);
      lines.push("Q. Cancel");
      sendText(`Choose a theme:\n\n${lines.join("\n")}`);
    },
    [sendText],
  );

  const notifyTerminalOnly = useCallback((message: string) => sendText(message), [sendText]);

  const consumeSlashReply = useCallback(
    (text: string, _platform: string): boolean => {
      const pickedIndex = parseIndexedChoice(text);
      switch (slashInteractionRef.current.kind) {
        case "sessions_picker": {
          const sessions = (slashInteractionRef.current.payload as SessionInfo[]) ?? [];
          slashInteractionRef.current = { kind: null, payload: null };
          if (isCancelText(text)) return true;
          if (isNewText(text)) {
            if (onCreateSession) {
              onCreateSession(freshSessionName(sessionName ?? undefined));
              sendText("Switched to a new session.");
            } else {
              sendText("This runtime cannot switch sessions remotely.");
            }
            return true;
          }
          if (pickedIndex >= 0 && pickedIndex < sessions.length) {
            const target = sessions[pickedIndex];
            if (!target) return true;
            if (onSelectSession) {
              onSelectSession(target.name);
              sendText(`Switched to session: ${target.name}`);
            } else {
              sendText(`Switch to session in the terminal: ${target.name}`);
            }
          }
          return true;
        }
        case "checkpoint_picker": {
          const checkpoints = (slashInteractionRef.current.payload as CheckpointMeta[]) ?? [];
          slashInteractionRef.current = { kind: null, payload: null };
          if (isCancelText(text)) return true;
          if (pickedIndex >= 0 && pickedIndex < checkpoints.length) {
            const target = checkpoints[pickedIndex];
            if (!target) return true;
            const result = restoreCheckpoint(currentRootDir, target.id);
            const msg = [
              `Restored "${target.name}" (${target.id.slice(0, 7)}, ${fmtAgo(target.createdAt)})`,
            ];
            if (result.restored.length > 0) msg.push(`Wrote ${result.restored.length} file(s)`);
            if (result.removed.length > 0) msg.push(`Deleted ${result.removed.length} file(s)`);
            if (result.skipped.length > 0) msg.push(`Skipped ${result.skipped.length} file(s)`);
            const message = msg.join("\n");
            log.pushInfo(message);
            sendText(message);
          }
          return true;
        }
        case "model_picker": {
          const choices = (slashInteractionRef.current.payload as string[]) ?? [];
          slashInteractionRef.current = { kind: null, payload: null };
          if (isCancelText(text)) return true;
          if (pickedIndex >= 0 && pickedIndex < choices.length) {
            const target = choices[pickedIndex];
            if (!target) return true;
            const message = onModelPick(target);
            log.pushInfo(message);
            sendText(message);
          }
          return true;
        }
        case "theme_picker": {
          const choices = (slashInteractionRef.current.payload as ThemeChoice[]) ?? [];
          slashInteractionRef.current = { kind: null, payload: null };
          if (isCancelText(text)) return true;
          if (pickedIndex >= 0 && pickedIndex < choices.length) {
            const target = choices[pickedIndex];
            if (!target) return true;
            const message = onThemePick(target);
            log.pushInfo(message);
            sendText(message);
          }
          return true;
        }
        default:
          return false;
      }
    },
    [
      currentRootDir,
      log,
      onCreateSession,
      onModelPick,
      onSelectSession,
      onThemePick,
      sendText,
      sessionName,
    ],
  );

  const consumePauseReply = useCallback(
    (text: string, _platform: string): boolean => {
      if (interactionRef.current.kind === null || pendingGateIdRef.current === null) return false;
      replyThisTurnRef.current = true;
      replyPlatformRef.current = _platform;
      const followup = stripFollowupPrefix(text);
      const interaction = interactionRef.current;
      interactionRef.current = { kind: null, payload: null };
      switch (interaction.kind) {
        case "run_command":
        case "run_background":
          onShellConfirmRef.current(parseRunPermissionChoice(text));
          return true;
        case "path_access":
          onPathConfirmRef.current(parseRunPermissionChoice(text));
          return true;
        case "plan_proposed": {
          const p = (interaction.payload as { plan?: string }) ?? {};
          const choice = parsePlanChoice(text);
          if (choice === "cancel") {
            void onPlanCancelRef.current();
          } else {
            void onPlanFeedbackRef.current(followup, {
              plan: p.plan ?? "",
              mode: choice === "approve" ? "approve" : "refine",
            });
          }
          return true;
        }
        case "plan_checkpoint": {
          const p = (interaction.payload as { stepId?: string; title?: string }) ?? {};
          const choice = parseCheckpointChoice(text);
          if (choice === "revise") {
            onCheckpointReviseRef.current(followup, { stepId: p.stepId ?? "", title: p.title });
          } else {
            onCheckpointConfirmRef.current(choice);
          }
          return true;
        }
        case "plan_revision":
          onPlanRevisionRef.current(parseRevisionChoice(text));
          return true;
        case "choice": {
          const p =
            (interaction.payload as { options?: ChoiceOption[]; allowCustom?: boolean }) ?? {};
          const options = p.options ?? [];
          const pickedIndex = parseIndexedChoice(text);
          if (pickedIndex >= 0 && pickedIndex < options.length) {
            const selected = options[pickedIndex];
            if (selected) onChoiceResolveRef.current({ type: "pick", optionId: selected.id });
            return true;
          }
          for (const opt of options) {
            if (text.toLowerCase().includes(opt.title.toLowerCase())) {
              onChoiceResolveRef.current({ type: "pick", optionId: opt.id });
              return true;
            }
          }
          if (p.allowCustom) {
            onChoiceResolveRef.current({ type: "text", text });
          } else {
            onChoiceResolveRef.current({ type: "cancel" });
          }
          return true;
        }
        default:
          return false;
      }
    },
    [
      onCheckpointConfirmRef,
      onCheckpointReviseRef,
      onChoiceResolveRef,
      onPathConfirmRef,
      onPlanCancelRef,
      onPlanFeedbackRef,
      onPlanRevisionRef,
      onShellConfirmRef,
      pendingGateIdRef,
    ],
  );

  const getPlatformForSubmit = useCallback((text: string) => extractPlatform(text), []);

  const parseSubmit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return null;
      const platform = extractPlatform(text);
      const fromRemote = platform !== undefined;
      if (fromRemote) {
        const body = text.replace(/^\[\w+\]\s*/, "");
        if (consumeSlashReply(body, platform!) || consumePauseReply(body, platform!)) {
          return { handled: true, fromRemote, platform, text: body };
        }
      }
      return { handled: false, fromRemote: !!fromRemote, platform, text };
    },
    [consumePauseReply, consumeSlashReply],
  );

  const noteTurnFromRemote = useCallback((fromRemote: boolean, platform?: string) => {
    replyThisTurnRef.current = fromRemote;
    replyPlatformRef.current = platform;
  }, []);

  const maybeSendFinalReply = useCallback(
    (lastAssistantText: string) => {
      if (channelMapRef.current.size === 0 || !lastAssistantText || !replyThisTurnRef.current)
        return;
      const platform = replyPlatformRef.current;
      if (platform) {
        channelMapRef.current
          .get(platform)
          ?.sendResponse(lastAssistantText)
          .catch((err) =>
            log.pushWarning(platform, `sendResponse error: ${(err as Error).message}`),
          );
      } else {
        for (const ch of channelMapRef.current.values()) {
          ch.sendResponse(lastAssistantText).catch((err) =>
            log.pushWarning(ch.platform, `sendResponse error: ${(err as Error).message}`),
          );
        }
      }
    },
    [log],
  );

  const clearTurnReply = useCallback(() => {
    replyThisTurnRef.current = false;
    replyPlatformRef.current = undefined;
  }, []);

  const handlePauseRequest = useCallback(
    (kind: string, payload: Record<string, unknown>) => {
      if (channelMapRef.current.size === 0) return;
      interactionRef.current = { kind: kind as InteractionKind, payload };
      let msg = "";
      switch (kind) {
        case "run_command":
        case "run_background": {
          const p = payload as { command: string };
          msg = `Need confirmation\n\nCommand: \`${p.command}\`\n\nReply with:\n1. Run once\n2. Always allow\n3. Deny`;
          break;
        }
        case "path_access": {
          const p = payload as { path: string; intent: "read" | "write"; toolName: string };
          msg = `Need file access confirmation\n\nAction: ${p.intent === "read" ? "Read" : "Write"}\nPath: ${p.path}\nTool: ${p.toolName}\n\nReply with:\n1. Run once\n2. Always allow\n3. Deny`;
          break;
        }
        case "plan_proposed": {
          const p = payload as { plan: string };
          msg = `Plan confirmation\n\n${p.plan}\n\nReply with:\n1. Approve\n2. Refine\n3. Cancel`;
          break;
        }
        case "plan_checkpoint": {
          const p = payload as { title?: string; result: string };
          const completed = completedStepIdsRef.current.size;
          const total = planStepsRef.current?.length ?? 0;
          msg = `Step complete (${completed}/${total})\n\n${p.title ? `Step: ${p.title}\n` : ""}Result: ${p.result}\n\nReply with:\n1. Continue\n2. Revise\n3. Stop`;
          break;
        }
        case "plan_revision": {
          const p = payload as { reason: string };
          msg = `Plan revision proposed\n\n${p.reason}\n\nReply with:\n1. Accept\n2. Reject\n3. Cancel`;
          break;
        }
        case "choice": {
          const p = payload as { question: string; options: ChoiceOption[]; allowCustom: boolean };
          msg = `Please choose\n\n${p.question}\n\n${p.options.map((o, i) => `${i + 1}. ${o.title}`).join("\n")}${p.allowCustom ? "\n\n(You can also reply with custom text.)" : ""}`;
          break;
        }
      }
      if (msg) sendText(msg);
    },
    [completedStepIdsRef, planStepsRef, sendText],
  );

  const buildModelChoices = useCallback(
    (models: string[] | null | undefined) => [
      "auto",
      "flash",
      "pro",
      ...(models && models.length > 0
        ? models
        : ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]),
    ],
    [],
  );

  const buildThemeChoices = useCallback((): ThemeChoice[] => ["auto", ...listThemeNames()], []);

  const handleRemoteSlashResult = useCallback(
    (args: RemoteSlashHandlingArgs): boolean => {
      const { result, codeMode: cm, sessions, checkpoints, models, restoreCodeOnlyMessage } = args;
      if (result.openSessionsPicker) {
        beginSessionsPicker(sessions);
        return true;
      }
      if (result.openCheckpointPicker) {
        if (!cm) {
          sendInfo(restoreCodeOnlyMessage);
          return true;
        }
        beginCheckpointPicker(checkpoints);
        return true;
      }
      if (result.openMcpHub) {
        notifyTerminalOnly("`/mcp` is terminal-only.");
        return true;
      }
      if (result.openModelPicker) {
        beginModelPicker(buildModelChoices(models));
        return true;
      }
      if (result.openThemePicker) {
        beginThemePicker(buildThemeChoices());
        return true;
      }
      if (result.openCopyMode) {
        notifyTerminalOnly("`/copy` is terminal-only.");
        return true;
      }
      if (result.openArgPickerFor) {
        notifyTerminalOnly(`\`/${result.openArgPickerFor}\` is terminal-only.`);
        return true;
      }
      return false;
    },
    [
      beginCheckpointPicker,
      beginModelPicker,
      beginSessionsPicker,
      beginThemePicker,
      buildModelChoices,
      buildThemeChoices,
      notifyTerminalOnly,
      sendInfo,
    ],
  );

  return useMemo(
    () => ({
      channelRefs: channelMapRef.current,
      registerChannel,
      unregisterChannel,
      sendInfo,
      sendText,
      resetInteractions,
      clearSlashInteraction,
      canBypassBusy,
      consumeSlashReply,
      consumePauseReply,
      beginSessionsPicker,
      beginCheckpointPicker,
      beginModelPicker,
      beginThemePicker,
      notifyTerminalOnly,
      noteTurnFromRemote,
      maybeSendFinalReply,
      clearTurnReply,
      handlePauseRequest,
      buildModelChoices,
      buildThemeChoices,
      parseSubmit,
      handleRemoteSlashResult,
      getPlatformForSubmit,
    }),
    [
      beginCheckpointPicker,
      beginModelPicker,
      beginSessionsPicker,
      beginThemePicker,
      buildModelChoices,
      buildThemeChoices,
      canBypassBusy,
      clearSlashInteraction,
      clearTurnReply,
      consumePauseReply,
      consumeSlashReply,
      getPlatformForSubmit,
      handlePauseRequest,
      handleRemoteSlashResult,
      maybeSendFinalReply,
      noteTurnFromRemote,
      notifyTerminalOnly,
      parseSubmit,
      registerChannel,
      resetInteractions,
      sendInfo,
      sendText,
      unregisterChannel,
    ],
  );
}
