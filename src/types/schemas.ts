import { z } from "zod";

export const ViewportSchema = z.object({
  w: z.number().int().positive().max(10000),
  h: z.number().int().positive().max(10000),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  repoPath: z.string().min(1).nullish(),
  viewport: ViewportSchema.optional(),
  authStorageState: z.string().nullish(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const AnnotationShapeEnum = z.enum(["pin", "box", "arrow"]);
export const AnnotationTypeEnum = z.enum(["bug", "change", "question", "idea"]);
export const SeverityEnum = z.enum(["low", "med", "high"]);
export const AnnotationStatusEnum = z.enum(["open", "resolved"]);

export const CreateAnnotationSchema = z.object({
  shape: AnnotationShapeEnum.default("pin"),
  x: z.number(),
  y: z.number(),
  w: z.number().nullish(),
  h: z.number().nullish(),
  elementId: z.string().nullish(),
  note: z.string().default(""),
  type: AnnotationTypeEnum.default("change"),
  severity: SeverityEnum.default("med"),
  suggestion: z.string().nullish(),
  status: AnnotationStatusEnum.default("open"),
});
export type CreateAnnotationInput = z.infer<typeof CreateAnnotationSchema>;

export const UpdateAnnotationSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().nullish(),
  h: z.number().nullish(),
  elementId: z.string().nullish(),
  note: z.string().optional(),
  type: AnnotationTypeEnum.optional(),
  severity: SeverityEnum.optional(),
  suggestion: z.string().nullish(),
  status: AnnotationStatusEnum.optional(),
});
export type UpdateAnnotationInput = z.infer<typeof UpdateAnnotationSchema>;
