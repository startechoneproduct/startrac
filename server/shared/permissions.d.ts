export interface PermissionInfo { key: string; label: string }
export interface PermissionGroup { key: string; label: string; perms: PermissionInfo[] }

export const PERMISSION_GROUPS: PermissionGroup[];
export const ALL_PERMS: string[];
export const EXPANDS: Record<string, string[]>;
export function expandPerms(perms: string[]): string[];
