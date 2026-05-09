import { AccountType } from "../auth/authEnum";

/** Admin-only guard message or null if OK. */
export function assertAdminUser(authUser: any): string | null {
  const at = String(authUser?.account_type ?? "").trim().toLowerCase();
  if (!authUser || at !== String(AccountType.ADMIN).toLowerCase()) {
    return "Only admin can perform this action";
  }
  return null;
}

/**
 * When extraInfo.admin_permissions has keys, any permission set to false denies that action.
 * Empty / missing permissions = full access (backwards compatible).
 */
export function assertAdminPermission(authUser: any, permissionKey: string): string | null {
  const adminErr = assertAdminUser(authUser);
  if (adminErr) return adminErr;
  const p = authUser?.extraInfo?.admin_permissions;
  if (!p || typeof p !== "object" || Object.keys(p).length === 0) return null;
  if (p[permissionKey] === false) {
    return "This action is disabled for your admin account";
  }
  return null;
}
