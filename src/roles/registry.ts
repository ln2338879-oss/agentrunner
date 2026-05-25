import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parse } from "yaml";
import { DefaultRoleAliases, DefaultRoleDefinitions } from "./default-roles";
import { RoleRegistryConfigSchema, type RoleDefinition, type RoleRegistryConfig } from "./types";

export interface RoleRegistryOptions {
  path?: string;
  includeDefaults?: boolean;
}

export class RoleRegistry {
  private readonly roles = new Map<string, RoleDefinition>();
  private readonly aliases = new Map<string, string>();

  constructor(config: RoleRegistryConfig = { roles: [], aliases: {} }, includeDefaults = true) {
    if (includeDefaults) {
      for (const role of DefaultRoleDefinitions) this.addRole(role);
      for (const [alias, roleId] of Object.entries(DefaultRoleAliases)) this.aliases.set(alias, roleId);
    }

    for (const role of config.roles) this.addRole(role);
    for (const [alias, roleId] of Object.entries(config.aliases)) this.aliases.set(alias, roleId);
  }

  static async load(options: RoleRegistryOptions = {}): Promise<RoleRegistry> {
    const includeDefaults = options.includeDefaults ?? true;
    if (!options.path || !existsSync(options.path)) {
      return new RoleRegistry({ roles: [], aliases: {} }, includeDefaults);
    }

    const text = await readFile(options.path, "utf-8");
    const parsed = RoleRegistryConfigSchema.parse(parse(text));
    return new RoleRegistry(parsed, includeDefaults);
  }

  addRole(role: RoleDefinition): void {
    this.roles.set(role.id, role);
    if (role.legacyRole) this.aliases.set(role.legacyRole, role.id);
  }

  resolve(idOrAlias: string): RoleDefinition | null {
    const roleId = this.aliases.get(idOrAlias) ?? idOrAlias;
    return this.roles.get(roleId) ?? null;
  }

  require(idOrAlias: string): RoleDefinition {
    const role = this.resolve(idOrAlias);
    if (!role) throw new Error(`Unknown role: ${idOrAlias}`);
    return role;
  }

  list(): RoleDefinition[] {
    return [...this.roles.values()];
  }

  listAliases(): Record<string, string> {
    return Object.fromEntries(this.aliases.entries());
  }
}

export function createDefaultRoleRegistry(): RoleRegistry {
  return new RoleRegistry();
}
