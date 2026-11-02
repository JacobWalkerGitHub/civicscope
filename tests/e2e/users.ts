/** Test-only accounts created in a throwaway database by run.ts. */
export const E2E_PASSWORD = 'e2e-password-long-enough';
export const E2E_USERS = {
  owner: { email: 'owner@e2e.test', name: 'E2E Owner', role: 'owner' },
  reviewer: { email: 'reviewer@e2e.test', name: 'E2E Reviewer', role: 'reviewer' },
  editor: { email: 'editor@e2e.test', name: 'E2E Editor', role: 'editor' },
  viewer: { email: 'viewer@e2e.test', name: 'E2E Viewer', role: 'viewer' },
  lockout: { email: 'lockout@e2e.test', name: 'E2E Lockout', role: 'editor' },
} as const;
