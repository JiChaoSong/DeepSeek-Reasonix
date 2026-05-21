// useQQChannel — QQ 通道的 React Hook（基于通用 useRemoteChannel）。

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ThemeChoice } from "../cli/ui/ThemePicker.js";
import { loadQQConfig, saveQQConfig } from "../config.js";
import { t } from "../i18n/index.js";
import type { RemoteChannel } from "../remote/types.js";
import { useRemoteChannel } from "../remote/use-remote-channel.js";
import { QQChannel } from "./channel.js";
import {
  type QQSetupStep,
  formatQQAccessSummary,
  formatQQModeLabel,
  formatQQSetupPrompt,
  formatQQSetupWaiting,
} from "./strings.js";

interface QQLogger {
  pushInfo: (text: string) => void;
  pushWarning: (title: string, detail: string) => void;
}

interface PendingQQConnectSetup {
  step: QQSetupStep;
  appId?: string;
  appSecret?: string;
  sandbox: boolean;
  ownerOpenId?: string;
  allowlist?: readonly string[];
  resolve: (message: string) => void;
  reject: (error: Error) => void;
  promise: Promise<string>;
}

export interface UseQQChannelArgs {
  codeMode: boolean;
  initialChannel?: QQChannel;
  log: QQLogger;
  setQueuedSubmit: (text: string) => void;
  qqSubmitRef?: { current: ((text: string) => void) | null };
  qqErrorRef?: { current: ((msg: string) => void) | null };
  sessionName?: string | null;
  currentRootDir: string;
  pendingGateIdRef: { current: number | null };
  completedStepIdsRef: { current: Set<string> };
  planStepsRef: { current: import("../tools/plan.js").PlanStep[] | null };
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
  onPlanRevisionRef: {
    current: (choice: import("../cli/ui/PlanReviseConfirm.js").ReviseChoice | "cancel") => void;
  };
  onChoiceResolveRef: {
    current: (
      resolution:
        | { type: "pick"; optionId: string }
        | { type: "text"; text: string }
        | { type: "cancel" },
    ) => void;
  };
}

export function useQQChannel(args: UseQQChannelArgs) {
  const {
    codeMode,
    initialChannel,
    log,
    setQueuedSubmit,
    qqSubmitRef,
    qqErrorRef,
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

  const remoteArgs = useMemo(
    () => ({
      codeMode,
      initialChannels: initialChannel ? [initialChannel as RemoteChannel] : undefined,
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
    }),
    [
      codeMode,
      initialChannel,
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
    ],
  );

  const remote = useRemoteChannel(remoteArgs);
  const pendingConnectSetupRef = useRef<PendingQQConnectSetup | null>(null);
  const channelRef = useRef<QQChannel | null>(initialChannel ?? null);

  useEffect(() => {
    if (initialChannel) channelRef.current = initialChannel;
  }, [initialChannel]);

  const persistQQConfig = useCallback(
    (config: {
      appId: string;
      appSecret: string;
      sandbox: boolean;
      enabled: boolean;
      ownerOpenId?: string;
      allowlist?: readonly string[];
    }) => {
      saveQQConfig({
        appId: config.appId,
        appSecret: config.appSecret,
        sandbox: config.sandbox,
        enabled: config.enabled,
        ownerOpenId: config.ownerOpenId,
        allowlist: config.allowlist ? [...config.allowlist] : undefined,
      });
    },
    [],
  );

  const completeConnect = useCallback(
    async (params: {
      appId: string;
      appSecret: string;
      sandbox: boolean;
      ownerOpenId?: string;
      allowlist?: readonly string[];
    }) => {
      if (!params.appId || !params.appSecret) throw new Error(t("handlers.qq.credentialsRequired"));
      persistQQConfig({ ...params, enabled: false });
      if (channelRef.current) {
        persistQQConfig({ ...params, enabled: true });
        channelRef.current.refreshAccessConfig();
        return t("handlers.qq.alreadyConnected", { mode: formatQQModeLabel(codeMode) });
      }
      const channel = new QQChannel({
        onSubmitMessage: (message) => setQueuedSubmit(message),
        onError: (message) => log.pushWarning("QQ", message),
      });
      await channel.start();
      channelRef.current = channel;
      remote.registerChannel(channel);
      persistQQConfig({ ...params, enabled: true });
      return t("handlers.qq.connected", { mode: formatQQModeLabel(codeMode) });
    },
    [codeMode, log, persistQQConfig, remote, setQueuedSubmit],
  );

  const beginConnectSetup = useCallback(
    (params: {
      appId?: string;
      appSecret?: string;
      sandbox: boolean;
      ownerOpenId?: string;
      allowlist?: readonly string[];
    }): Promise<string> => {
      const existing = pendingConnectSetupRef.current;
      if (existing) {
        log.pushInfo(formatQQSetupWaiting(existing.step));
        return existing.promise;
      }
      let r: ((m: string) => void) | null = null;
      let j: ((e: Error) => void) | null = null;
      const promise = new Promise<string>((resolve, reject) => {
        r = resolve;
        j = reject;
      });
      const step: QQSetupStep = params.appId ? "appSecret" : "appId";
      pendingConnectSetupRef.current = { step, ...params, resolve: r!, reject: j!, promise };
      log.pushInfo(formatQQSetupPrompt(step));
      return promise;
    },
    [log],
  );

  const connect = useCallback(
    async (args: readonly string[]): Promise<string> => {
      const existing = loadQQConfig();
      const appId = args[0]?.trim() || existing.appId || "";
      const appSecret = args[1]?.trim() || existing.appSecret || "";
      const sandboxArg = args[2]?.trim().toLowerCase();
      const sandbox =
        sandboxArg === "sandbox" ||
        sandboxArg === "true" ||
        sandboxArg === "1" ||
        sandboxArg === "yes"
          ? true
          : sandboxArg === "prod" ||
              sandboxArg === "false" ||
              sandboxArg === "0" ||
              sandboxArg === "no"
            ? false
            : (existing.sandbox ?? false);
      if (!appId || !appSecret) {
        return beginConnectSetup({
          appId: appId || undefined,
          appSecret: appSecret || undefined,
          sandbox,
          ownerOpenId: existing.ownerOpenId,
          allowlist: existing.allowlist,
        });
      }
      return completeConnect({
        appId,
        appSecret,
        sandbox,
        ownerOpenId: existing.ownerOpenId,
        allowlist: existing.allowlist,
      });
    },
    [beginConnectSetup, completeConnect],
  );

  const disconnect = useCallback(async (): Promise<string> => {
    const pending = pendingConnectSetupRef.current;
    if (pending) {
      pendingConnectSetupRef.current = null;
      pending.reject(new Error(t("handlers.qq.setupCancelled")));
    }
    const existing = loadQQConfig();
    channelRef.current = null;
    await remote.unregisterChannel("qq");
    saveQQConfig({ ...existing, enabled: false });
    return t("handlers.qq.disconnected");
  }, [remote]);

  const status = useCallback((): string => {
    const config = loadQQConfig();
    const configured = config.appId && config.appSecret;
    const connected = !!channelRef.current;
    const enabled = !!config.enabled;
    const appId = config.appId ? `${config.appId.slice(0, 6)}...` : t("handlers.qq.none");
    const sandbox = config.sandbox ? t("handlers.qq.sandbox") : t("handlers.qq.production");
    const access = channelRef.current
      ? formatQQAccessSummary({
          ownerOpenId: config.ownerOpenId,
          allowlist: config.allowlist,
          runtimeBoundOpenId: channelRef.current.getRuntimeBoundOpenId(),
        })
      : formatQQAccessSummary({ ownerOpenId: config.ownerOpenId, allowlist: config.allowlist });
    const pending = pendingConnectSetupRef.current;
    if (pending) return t("handlers.qq.statusSetup", { step: formatQQSetupWaiting(pending.step) });
    return t("handlers.qq.status", {
      connected: connected ? t("handlers.qq.stateConnected") : t("handlers.qq.stateDisconnected"),
      enabled: enabled ? t("handlers.qq.stateEnabled") : t("handlers.qq.stateDisabled"),
      configured: configured
        ? t("handlers.qq.stateConfigured")
        : t("handlers.qq.stateNotConfigured"),
      appId,
      sandbox,
      access,
      mode: formatQQModeLabel(codeMode),
    });
  }, [codeMode]);

  // backward-compat: parseSubmit maps fromRemote -> fromQQ
  const parseSubmit = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return null;
      // QQ interactive setup flow
      if (!text.startsWith("[") && pendingConnectSetupRef.current) {
        const lower = text.toLowerCase();
        const pending = pendingConnectSetupRef.current;
        if (lower === "/cancel" || lower === "cancel") {
          pendingConnectSetupRef.current = null;
          pending.reject(new Error(t("handlers.qq.setupCancelled")));
          log.pushInfo(t("handlers.qq.setupCancelled"));
          return { handled: true, fromQQ: false, text } as const;
        }
        if (pending.step === "appId") {
          pending.appId = text;
          pending.step = "appSecret";
          log.pushInfo(formatQQSetupPrompt("appSecret"));
          return { handled: true, fromQQ: false, text } as const;
        }
        pending.appSecret = text;
        pendingConnectSetupRef.current = null;
        void completeConnect({
          appId: pending.appId ?? "",
          appSecret: pending.appSecret ?? "",
          sandbox: pending.sandbox,
          ownerOpenId: pending.ownerOpenId,
          allowlist: pending.allowlist,
        }).then(pending.resolve, (err) => pending.reject(err as Error));
        return { handled: true, fromQQ: false, text } as const;
      }
      const result = remote.parseSubmit(raw);
      if (!result) return null;
      return { handled: result.handled, fromQQ: result.fromRemote, text: result.text };
    },
    [completeConnect, log, remote],
  );

  const bindTransportRefs = useCallback(() => {
    if (!qqSubmitRef || !qqErrorRef) return () => undefined;
    qqSubmitRef.current = setQueuedSubmit;
    qqErrorRef.current = (msg) => log.pushWarning("QQ", msg);
    return () => {
      qqSubmitRef.current = null;
      qqErrorRef.current = null;
    };
  }, [log, qqErrorRef, qqSubmitRef, setQueuedSubmit]);

  useEffect(() => bindTransportRefs(), [bindTransportRefs]);

  return useMemo(
    () => ({
      channelRef,
      connect,
      disconnect,
      status,
      registerChannel: remote.registerChannel,
      unregisterChannel: remote.unregisterChannel,
      sendInfo: remote.sendInfo,
      sendText: remote.sendText,
      resetInteractions: remote.resetInteractions,
      clearSlashInteraction: remote.clearSlashInteraction,
      canBypassBusy: remote.canBypassBusy,
      consumeSlashReply: (text: string) => remote.consumeSlashReply(text, "qq"),
      consumePauseReply: (text: string) => remote.consumePauseReply(text, "qq"),
      beginSessionsPicker: remote.beginSessionsPicker,
      beginCheckpointPicker: remote.beginCheckpointPicker,
      beginModelPicker: remote.beginModelPicker,
      beginThemePicker: remote.beginThemePicker,
      notifyTerminalOnly: remote.notifyTerminalOnly,
      noteTurnFromQQ: (fromQQ: boolean, platform?: string) =>
        remote.noteTurnFromRemote(fromQQ, platform ?? "qq"),
      maybeSendFinalReply: remote.maybeSendFinalReply,
      clearTurnReply: remote.clearTurnReply,
      handlePauseRequest: remote.handlePauseRequest,
      buildModelChoices: remote.buildModelChoices,
      buildThemeChoices: remote.buildThemeChoices,
      parseSubmit,
      handleRemoteSlashResult: remote.handleRemoteSlashResult,
    }),
    [
      connect,
      disconnect,
      parseSubmit,
      status,
      remote.beginCheckpointPicker,
      remote.registerChannel,
      remote.unregisterChannel,
      remote.beginModelPicker,
      remote.beginSessionsPicker,
      remote.beginThemePicker,
      remote.buildModelChoices,
      remote.buildThemeChoices,
      remote.canBypassBusy,
      remote.clearSlashInteraction,
      remote.clearTurnReply,
      remote.consumePauseReply,
      remote.consumeSlashReply,
      remote.handlePauseRequest,
      remote.handleRemoteSlashResult,
      remote.maybeSendFinalReply,
      remote.noteTurnFromRemote,
      remote.notifyTerminalOnly,
      remote.resetInteractions,
      remote.sendInfo,
      remote.sendText,
    ],
  );
}
