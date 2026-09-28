import { z } from 'zod';

export const StageKindEnum = z.enum(['registration', 'qualifying', 'final', 'results']);
export type StageKind = z.infer<typeof StageKindEnum>;

export const StageFormatEnum = z.enum(['online', 'offline', 'hybrid']);
export type StageFormat = z.infer<typeof StageFormatEnum>;

export const SubscriptionStatusEnum = z.enum(['interested', 'registered', 'done', 'dropped']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusEnum>;

export const ReminderStatusEnum = z.enum(['pending', 'sent', 'failed', 'cancelled']);
export type ReminderStatus = z.infer<typeof ReminderStatusEnum>;

export const ReminderKindEnum = z.enum(['reg_start', 'reg_3d', 'reg_1d', 'stage_1d', 'demo_1m', 'custom']);
export type ReminderKind = z.infer<typeof ReminderKindEnum>;

export const StageSchema = z.object({
  id: z.string(),
  kind: StageKindEnum,
  name: z.string(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  region_code: z.string().nullable().optional(),
  format: StageFormatEnum,
});
export type Stage = z.infer<typeof StageSchema>;

export const OlympiadSchema = z.object({
  id: z.string(),
  title: z.string(),
  organizer: z.string(),
  rsosh_level: z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
  subjects: z.array(z.string()),
  grade_from: z.number().int().min(1).max(11),
  grade_to: z.number().int().min(1).max(11),
  benefits_note: z.string(),
  url: z.string().url(),
  source_url: z.string().url(),
  verified_at: z.string().datetime({ offset: true }),
  is_demo: z.boolean().optional(),
  stages: z.array(StageSchema),
});
export type Olympiad = z.infer<typeof OlympiadSchema>;

export const UserProfileSchema = z.object({
  id: z.number().int().optional(),
  max_user_id: z.string(),
  grade: z.number().int().min(1).max(11).nullable().optional(),
  region_code: z.string().nullable().optional(),
  timezone: z.string().default('Europe/Moscow'),
  quiet_from: z.string().default('22:00'),
  quiet_to: z.string().default('08:00'),
  consent_at: z.string().datetime({ offset: true }).nullable().optional(),
  subjects: z.array(z.string()).default([]),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateProfileInputSchema = z.object({
  grade: z.coerce.number().int().min(1).max(11).optional(),
  subjects: z.array(z.string()).optional(),
  region_code: z.string().nullable().optional(),
  timezone: z.string().optional(),
  quiet_from: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).or(z.literal('')).optional(),
  quiet_to: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).or(z.literal('')).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

export const CreateSubscriptionInputSchema = z.object({
  olympiad_id: z.string(),
});
export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionInputSchema>;

export const UpdateSubscriptionStatusSchema = z.object({
  status: z.enum(['registered', 'dropped', 'interested', 'done']),
});
export type UpdateSubscriptionStatusInput = z.infer<typeof UpdateSubscriptionStatusSchema>;

export const SubscriptionWithDetailsSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int(),
  olympiad_id: z.string(),
  status: SubscriptionStatusEnum,
  created_at: z.string(),
  updated_at: z.string(),
  olympiad: OlympiadSchema.optional(),
  next_deadline: z.object({
    stage_id: z.string(),
    stage_name: z.string(),
    kind: StageKindEnum,
    date: z.string(),
  }).nullable().optional(),
});
export type SubscriptionWithDetails = z.infer<typeof SubscriptionWithDetailsSchema>;
