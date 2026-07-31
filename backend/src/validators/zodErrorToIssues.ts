import type { ZodError } from 'zod';
import type { ValidationIssue } from '../errors';

export type ValidationSection = 'params' | 'query' | 'body';

/**
 * The one place Zod's own error shape is translated into this codebase's
 * ValidationIssue — errors/ValidationError.ts's `path` is a plain
 * dot-joined string, not Zod's native (string|number)[] path array.
 * Nothing outside this function needs to know Zod's error shape exists.
 */
export function zodErrorToIssues(error: ZodError, section: ValidationSection): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [section, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}
