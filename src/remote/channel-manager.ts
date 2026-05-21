import type { RemoteChannel, RemoteChannelManager } from "./types.js";

export function createChannelManager(): RemoteChannelManager {
  const channels = new Map<string, RemoteChannel>();

  return {
    getChannel(platform: string) {
      return channels.get(platform);
    },
    getAllChannels() {
      return [...channels.values()];
    },
    async startAll() {
      const errors: string[] = [];
      for (const ch of channels.values()) {
        try {
          await ch.start();
        } catch (err) {
          errors.push(`${ch.platform}: ${(err as Error).message}`);
        }
      }
      if (errors.length > 0) throw new Error(errors.join("\n"));
    },
    async stopAll() {
      for (const ch of channels.values()) {
        try {
          await ch.stop();
        } catch {
          /* ignore */
        }
      }
      channels.clear();
    },
  };
}
