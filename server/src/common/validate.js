/**
 * validate.js – Express middleware for Zod schema validation
 *
 * Validates req.body against the provided schema. On failure,
 * forwards an AppError with code VALIDATION_ERROR and field details.
 */
import { errors } from './errors.js';

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.') || 'body';
        details[path] = issue.message;
      }
      return next(errors.validation('Invalid request data.', details));
    }
    req.body = result.data;
    next();
  };
}
