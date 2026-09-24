import {
  fetchPullRequest,
  parsePullRequestUrl,
  type GithubOptions,
} from "./github";
import { extractChunks, type SkippedFile } from "./extract";
import { review as llmReview, type LlmOptions } from "./llm";
import {
  ResultSchema,
  type Finding,
  type FindingCategory,
  type FindingSeverity,
  type ReviewResult,
} from "./schema";

export type ReviewOptions = GithubOptions & LlmOptions;

export type PullRequestReview = ReviewResult & {
  skipped: SkippedFile[];
};

export class ReviewError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ReviewError";
  }
}

export function computeCounts(findings: Finding[]): ReviewResult["counts"] {
  const bySeverity: Partial<Record<FindingSeverity, number>> = {};
  const byCategory: Partial<Record<FindingCategory, number>> = {};

  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + 1;
  }

  return { bySeverity, byCategory };
}

function formatZodError(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues)
  ) {
    const issues = (
      error as {
        issues: Array<{ path: Array<string | number>; message: string }>;
      }
    ).issues;
    return issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function parseAndValidate(raw: string):
  | { ok: true; result: ReviewResult }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const validated = ResultSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: `Schema validation failed: ${formatZodError(validated.error)}`,
    };
  }

  return { ok: true, result: validated.data };
}

function withRecomputedCounts(result: ReviewResult): ReviewResult {
  return {
    findings: result.findings,
    counts: computeCounts(result.findings),
  };
}

/**
 * Orchestrates a PR review: fetch GitHub diff → extract chunks → ask the LLM
 * → parse/validate JSON. Invalid output is retried once with a repair prompt.
 * Counts are always recomputed from the validated findings.
 */
export async function review(
  prUrl: string,
  options: ReviewOptions = {},
): Promise<PullRequestReview> {
  const ref = parsePullRequestUrl(prUrl);
  const payload = await fetchPullRequest(ref, {
    fetch: options.fetch,
    token: options.token,
  });
  const extraction = extractChunks(payload.diff);

  const llmOptions: LlmOptions = {
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    model: options.model,
    fetch: options.fetch,
  };

  const firstRaw = await llmReview(extraction.chunks, llmOptions);
  const first = parseAndValidate(firstRaw);
  if (first.ok) {
    return { ...withRecomputedCounts(first.result), skipped: extraction.skipped };
  }

  const repairRaw = await llmReview(extraction.chunks, {
    ...llmOptions,
    repair: { error: first.error, raw: firstRaw },
  });
  const repaired = parseAndValidate(repairRaw);
  if (!repaired.ok) {
    throw new ReviewError(
      `LLM output was invalid after one repair attempt. Last error: ${repaired.error}`,
    );
  }

  return { ...withRecomputedCounts(repaired.result), skipped: extraction.skipped };
}
