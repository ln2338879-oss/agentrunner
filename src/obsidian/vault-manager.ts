import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

export class VaultManager {
  constructor(private readonly vaultPath: string) {}

  resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error("Vault paths must be relative to the Obsidian vault root.");
    }
    return path.join(this.vaultPath, relativePath);
  }

  async ensureFolder(relativeFolder: string): Promise<void> {
    await mkdir(this.resolve(relativeFolder), { recursive: true });
  }

  async ensureDefaultFolders(): Promise<void> {
    await Promise.all([
      "00_Inbox",
      "01_Tasks",
      "02_GameDesign",
      "03_Content/items",
      "03_Content/monsters",
      "03_Content/npcs",
      "03_Content/quests",
      "04_Reviews",
      "05_BuilderReports",
      "06_FactoryOutputs",
      "07_Approved",
      "08_Recovery",
      "90_Prompts",
      "99_System",
    ].map((folder) => this.ensureFolder(folder)));
  }

  async writeNote(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolve(relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
  }

  async appendNote(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolve(relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await appendFile(fullPath, content, "utf-8");
  }

  async readNote(relativePath: string): Promise<string> {
    return readFile(this.resolve(relativePath), "utf-8");
  }
}
