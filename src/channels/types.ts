export interface RemoteChannelCallbacks {
  onSubmitMessage: (text: string) => void;
  onError?: (msg: string) => void;
}

export interface RemoteChannel {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendResponse(text: string): Promise<void>;
  refreshAccessConfig?(): void;
  describeAccess?(): string;
}
