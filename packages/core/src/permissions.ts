/**
 * Admin roles and what each may do. Every admin page and server action checks a
 * permission from this table on the server; hiding a button is never the control.
 */
export const USER_ROLES = ['owner', 'reviewer', 'editor', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = {
  /** See the admin dashboard and read drafts. */
  'admin:view': ['owner', 'reviewer', 'editor', 'viewer'],
  /** Create and edit drafts of candidates, races, claims and sources. */
  'content:edit': ['owner', 'reviewer', 'editor'],
  /** Mark claims verified and publish or unpublish content. */
  'content:publish': ['owner', 'reviewer'],
  /** Archive (soft delete) and restore records. */
  'content:archive': ['owner', 'reviewer'],
  /** Run CSV imports and resolve the ingestion review queue. */
  'data:import': ['owner', 'reviewer'],
  /** Read the full audit log. */
  'audit:view': ['owner', 'reviewer'],
  /** Invite, disable and change the role of admin users. */
  'users:manage': ['owner'],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: 'Full control, including users and settings.',
  reviewer: 'Edits, verifies and publishes content.',
  editor: 'Drafts and edits content; cannot publish.',
  viewer: 'Read-only access to the admin dashboard.',
};
