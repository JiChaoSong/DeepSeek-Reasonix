// Remote Channel interface — 通用 IM/消息平台接入接口。

export interface RemoteChannel {
  readonly platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendResponse(text: string): Promise<void>;
  getStatus(): ChannelStatus;
  describeAccess(): string;
  refreshConfig(): void;
}

export type ChannelStatus =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; error: string };

export interface RemoteIncomingMessage {
  userId: string;
  text: string;
  messageId?: string;
}

export interface RemoteChannelCallbacks {
  onMessage?: (message: RemoteIncomingMessage) => void;
  onError?: (msg: string) => void;
  onStatusChange?: (status: ChannelStatus) => void;
}

export type PauseInteractionKind =
  | "run_command"
  | "run_background"
  | "path_access"
  | "plan_proposed"
  | "plan_checkpoint"
  | "plan_revision"
  | "choice";

export type SlashInteractionKind =
  | "sessions_picker"
  | "checkpoint_picker"
  | "model_picker"
  | "theme_picker";

export interface RemoteChannelManager {
  getChannel(platform: string): RemoteChannel | undefined;
  getAllChannels(): RemoteChannel[];
  startAll(): Promise<void>;
  stopAll(): Promise<void>;
}
