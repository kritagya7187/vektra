import { AppError } from './AppError';

export class NotFoundError extends AppError {
  constructor(message: string, cause?: unknown) {
    super({ code: 'NOT_FOUND', statusCode: 404, message, cause });
  }
}
