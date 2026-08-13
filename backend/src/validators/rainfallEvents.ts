import { z } from 'zod';

export const rainfallEventDateParamSchema = z.object({
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'eventDate must be an ISO date (YYYY-MM-DD)'),
});

export type RainfallEventDateParam = z.infer<typeof rainfallEventDateParamSchema>;
