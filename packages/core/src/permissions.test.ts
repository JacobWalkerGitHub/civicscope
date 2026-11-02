import { describe, expect, it } from 'vitest';
import { PERMISSIONS, USER_ROLES, can } from './permissions';

describe('can', () => {
  it('lets only the owner manage users', () => {
    expect(USER_ROLES.filter((r) => can(r, 'users:manage'))).toEqual(['owner']);
  });

  it('lets editors draft but not publish', () => {
    expect(can('editor', 'content:edit')).toBe(true);
    expect(can('editor', 'content:publish')).toBe(false);
    expect(can('editor', 'content:archive')).toBe(false);
  });

  it('keeps viewers read-only', () => {
    const viewerPermissions = Object.keys(PERMISSIONS).filter((p) =>
      can('viewer', p as keyof typeof PERMISSIONS),
    );
    expect(viewerPermissions).toEqual(['admin:view']);
  });

  it('gives the owner every permission', () => {
    for (const p of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can('owner', p)).toBe(true);
    }
  });
});
