// Helpers for consuming reasoning-model output: strip <think> blocks and
// robustly extract JSON that may be wrapped in prose or markdown fences.

export function stripThink(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const dangling = out.indexOf("<think>");
  if (dangling !== -1) {
    out = out.slice(0, dangling); // unclosed (truncated) reasoning — drop it
  }
  return out.trim();
}

export function looseJsonParse(text: string): unknown {
  let t = stripThink(text).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through to substring extraction
  }
  const start = t.search(/[[{]/);
  if (start === -1) return undefined;
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (end <= start) return undefined;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
