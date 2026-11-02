import type { z } from 'zod';
import { fieldErrors } from '@civicscope/core';
import { CmsError } from './errors';

/** Validates input with a shared schema, turning failures into field-level CmsErrors. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new CmsError('Please fix the highlighted fields.', fieldErrors(result.error));
  }
  return result.data;
}
