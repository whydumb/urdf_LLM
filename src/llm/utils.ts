export type ChatRole = "user" | "assistant" | "system";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

function normaliseRole(role: ChatRole | string | undefined): ChatRole {
  switch (role) {
    case "assistant":
    case "system":
      return role;
    case "user":
    default:
      return "user";
  }
}

/**
 * Ensures the conversation turns are well-formed before sending to an LLM.
 */
export function strictFormat(turns: Iterable<Partial<ChatTurn>> | undefined | null): ChatTurn[] {
  if (!turns) return [];

  const formatted: ChatTurn[] = [];

  for (const entry of turns) {
    if (!entry) continue;
    const content = typeof entry.content === "string" ? entry.content.trim() : "";
    if (!content) continue;

    const role = normaliseRole(entry.role ?? "user");
    formatted.push({ role, content });
  }

  return formatted;
}

/**
 * Renders a human-readable version of conversation turns for logging/debugging.
 */
export function stringifyTurns(turns: Iterable<Partial<ChatTurn>> | undefined | null): string {
  if (!turns) return "";
  const lines: string[] = [];

  for (const entry of turns) {
    if (!entry?.content) continue;
    const role = normaliseRole(entry.role ?? "user");
    lines.push(`${role.toUpperCase()}: ${entry.content}`);
  }

  return lines.join("\n");
}
