// 消息分块工具 — 将长文本切分为适配 IM 平台长度限制的块。

const DEFAULT_MAX_BYTES = 1500;
const NATURAL_SPLIT_MIN_FRACTION = 0.6;

function fitUtf8Slice(text: string, maxBytes: number): string {
  let end = 0;
  let bytes = 0;
  for (const char of text) {
    const nextBytes = Buffer.byteLength(char, "utf8");
    if (bytes > 0 && bytes + nextBytes > maxBytes) break;
    end += char.length;
    bytes += nextBytes;
  }
  return end > 0 ? text.slice(0, end) : text.slice(0, 1);
}

function pickNaturalSplit(candidate: string): number {
  const minSplit = Math.floor(candidate.length * NATURAL_SPLIT_MIN_FRACTION);
  const splitters = ["\n\n", "\n", " "];
  for (const splitter of splitters) {
    const at = candidate.lastIndexOf(splitter);
    if (at >= minSplit) return at + splitter.length;
  }
  return candidate.length;
}

export function splitMessage(text: string, maxBytes = DEFAULT_MAX_BYTES): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, "utf8") <= maxBytes) {
      chunks.push(remaining);
      break;
    }
    const candidate = fitUtf8Slice(remaining, maxBytes);
    const splitAt = pickNaturalSplit(candidate);
    chunks.push(candidate.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
