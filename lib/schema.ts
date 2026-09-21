import { z } from "zod";

/**
 * Severity levels for a code-review finding.
 * - critical / high: must-fix before merge
 * - medium: strongly recommended
 * - low: nice-to-have / informational
 */
export const FindingSeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
]);

/**
 * Category classifies *why* the finding exists, driving how it is
 * surfaced / filtered downstream.
 */
export const FindingCategorySchema = z.enum([
  "correctness",
  "security",
  "performance",
  "maintainability",
]);

/**
 * A single code-review finding.
 *
 * Validation rules (enforced by Zod):
 * - line numbers must be positive integers (>= 1)
 * - startLine must be <= endLine
 * - confidence must be in [0, 1]
 * - codeSnippet is optional
 */
export const FindingSchema = z
  .object({
    file: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    severity: FindingSeveritySchema,
    category: FindingCategorySchema,
    title: z.string().min(1),
    explanation: z.string().min(1),
    suggestion: z.string().min(1),
    codeSnippet: z.string().optional(),
    confidence: z.number().min(0).max(1),
  })
  .refine((f) => f.startLine <= f.endLine, {
    message: "startLine must be <= endLine",
    path: ["startLine"],
  });

/**
 * Aggregated counts by severity and by category, plus the list itself.
 */
export const ResultSchema = z.object({
  findings: z.array(FindingSchema),
  counts: z.object({
    bySeverity: z.partialRecord(FindingSeveritySchema, z.number()),
    byCategory: z.partialRecord(FindingCategorySchema, z.number()),
  }),
});

export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingCategory = z.infer<typeof FindingCategorySchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResult = z.infer<typeof ResultSchema>;
