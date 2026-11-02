/** A problem the admin can fix: shown next to the form, never as a crash. */
export class CmsError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'CmsError';
  }
}

export class NotFoundError extends CmsError {
  constructor(what: string) {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

/** MySQL error code from a driver error, looking through Drizzle's wrapper. */
export function mysqlErrorCode(error: unknown): string | undefined {
  let e: unknown = error;
  while (e && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ER_')) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
