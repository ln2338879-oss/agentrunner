import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export async function loadSkillContext(input: {
  skillsDir: string;
  skillIds?: string[];
}): Promise<string> {
  const skillIds = input.skillIds ?? [];
  if (!input.skillsDir || !existsSync(input.skillsDir)) return "";

  const files = skillIds.length > 0
    ? skillIds.map((id) => path.join(input.skillsDir, `${id}.md`))
    : [path.join(input.skillsDir, "default.md")];

  const sections: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const content = await readFile(file, "utf-8");
    sections.push([`## ${path.basename(file, ".md")}`, "", content].join("\n"));
  }

  if (sections.length === 0) return "";

  return [
    "# Skill Context",
    "",
    "Apply the following project-specific skills, schemas, conventions, and policies.",
    "",
    ...sections,
  ].join("\n\n");
}
