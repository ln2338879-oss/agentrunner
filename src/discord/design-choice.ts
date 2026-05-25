import { needsDesignChoice } from "../design/review";
import { classifyTask } from "../router/classify";
import { formatUserPing } from "./mention-format";

export function buildDesignChoiceReply(input: { content: string; userId: string }): string | null {
  if (classifyTask(input.content).assignedTo !== "designer") return null;
  if (!needsDesignChoice(input.content)) return null;
  return `${formatUserPing(input.userId)} Please choose a design direction before generation.`;
}
