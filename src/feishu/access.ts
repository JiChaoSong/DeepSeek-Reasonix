// 飞书访问控制 — 与 QQ 的 owner/allowlist/runtime 模式一致。
// 使用飞书 open_id 作为用户标识。

export interface FeishuAccessConfig {
  ownerOpenId?: string;
  allowlist?: readonly string[];
  runtimeBoundOpenId?: string | null;
}

export type FeishuAccessMode = "owner" | "allowlist" | "runtime" | "open";

export type FeishuAccessDecision =
  | { accept: true; mode: FeishuAccessMode; bindRuntime: boolean }
  | { accept: false; reason: "unauthorized" };

function normalizeOpenId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAllowlist(
  values: readonly string[] | string | null | undefined,
): string[] | undefined {
  const list =
    typeof values === "string" ? values.split(/[,\s]+/) : Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of list) {
    const openid = normalizeOpenId(raw);
    if (!openid || seen.has(openid)) continue;
    seen.add(openid);
    normalized.push(openid);
  }
  return normalized.length > 0 ? normalized : undefined;
}

export function redactOpenId(openid: string | null | undefined): string {
  const normalized = normalizeOpenId(openid);
  if (!normalized) return "none";
  if (normalized.length <= 10) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

export function decideFeishuAccess(
  config: FeishuAccessConfig,
  openid: string,
): FeishuAccessDecision {
  const candidate = normalizeOpenId(openid);
  if (!candidate) return { accept: false, reason: "unauthorized" };

  const ownerOpenId = normalizeOpenId(config.ownerOpenId);
  const allowlist = normalizeAllowlist(config.allowlist) ?? [];
  const runtimeBoundOpenId = normalizeOpenId(config.runtimeBoundOpenId);

  if (ownerOpenId && candidate === ownerOpenId) {
    return { accept: true, mode: "owner", bindRuntime: false };
  }
  if (allowlist.includes(candidate)) {
    return { accept: true, mode: "allowlist", bindRuntime: false };
  }
  if (ownerOpenId || allowlist.length > 0) {
    return { accept: false, reason: "unauthorized" };
  }
  if (runtimeBoundOpenId) {
    if (candidate === runtimeBoundOpenId) {
      return { accept: true, mode: "runtime", bindRuntime: false };
    }
    return { accept: false, reason: "unauthorized" };
  }
  return { accept: true, mode: "open", bindRuntime: true };
}

export function describeFeishuAccess(config: FeishuAccessConfig): string {
  const ownerOpenId = normalizeOpenId(config.ownerOpenId);
  const allowlist = normalizeAllowlist(config.allowlist) ?? [];
  const runtimeBoundOpenId = normalizeOpenId(config.runtimeBoundOpenId);

  if (ownerOpenId) {
    const suffix = allowlist.length > 0 ? `, allowlist ${allowlist.length}` : "";
    return `owner ${redactOpenId(ownerOpenId)}${suffix}`;
  }
  if (allowlist.length > 0) {
    return `allowlist ${allowlist.length}`;
  }
  if (runtimeBoundOpenId) {
    return `first-sender (runtime only, ${redactOpenId(runtimeBoundOpenId)})`;
  }
  return "open (unbound)";
}
