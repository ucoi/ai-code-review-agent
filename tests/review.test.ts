import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Chunk, SkippedFile } from "@/lib/extract";
import type { Finding } from "@/lib/schema";

const SAMPLE_CHUNKS: Chunk[] = [
  {
    path: "src/util.ts",
    oldPath: null,
    status: "modified",
    binary: false,
    hunks: [],
    lines: [],
    addedLineNumbers: [2, 3],
  },
];

const SAMPLE_SKIPPED: SkippedFile[] = [
  { path: "package-lock.json", reason: "lockfile" },
];

const SAMPLE_FINDINGS: Finding[] = [
  {
    file: "src/util.ts",
    startLine: 2,
    endLine: 2,
    severity: "high",
    category: "security",
    title: "Hardcoded secret",
    explanation: "A secret is committed.",
    suggestion: "Use env vars.",
    confidence: 0.9,
  },
  {
    file: "src/util.ts",
    startLine: 3,
    endLine: 3,
    severity: "low",
    category: "maintainability",
    title: "Minor style",
    explanation: "Consider extracting.",
    suggestion: "Extract it.",
    confidence: 0.5,
  },
];

function validJsonWithWrongCounts(): string {
  return JSON.stringify({
    findings: SAMPLE_FINDINGS,
    counts: {
      bySeverity: { high: 99, low: 99, critical: 7 },
      byCategory: { security: 99, maintainability: 99 },
    },
  });
}

const parsePullRequestUrl = vi.fn();
const fetchPullRequest = vi.fn();
const extractChunks = vi.fn();
const llmReview = vi.fn();

vi.mock("@/lib/github", () => ({
  parsePullRequestUrl: (...args: unknown[]) => parsePullRequestUrl(...args),
  fetchPullRequest: (...args: unknown[]) => fetchPullRequest(...args),
}));

vi.mock("@/lib/extract", () => ({
  extractChunks: (...args: unknown[]) => extractChunks(...args),
}));

vi.mock("@/lib/llm", () => ({
  review: (...args: unknown[]) => llmReview(...args),
}));

const { review, ReviewError, computeCounts } = await import("@/lib/review");

const PR_URL = "https://github.com/octocat/Hello-World/pull/1";
const PR_REF = { owner: "octocat", repo: "Hello-World", number: 1 };

beforeEach(() => {
  parsePullRequestUrl.mockReset();
  fetchPullRequest.mockReset();
  extractChunks.mockReset();
  llmReview.mockReset();

  parsePullRequestUrl.mockReturnValue(PR_REF);
  fetchPullRequest.mockResolvedValue({
    ref: PR_REF,
    metadata: { title: "Test PR" },
    diff: "diff --git a/src/util.ts b/src/util.ts",
  });
  extractChunks.mockReturnValue({
    chunks: SAMPLE_CHUNKS,
    skipped: SAMPLE_SKIPPED,
  });
});

describe("review: happy path", () => {
  it("fetches the PR, extracts chunks, calls the LLM, and returns findings plus skipped files", async () => {
    llmReview.mockResolvedValue(validJsonWithWrongCounts());

    const result = await review(PR_URL);

    expect(parsePullRequestUrl).toHaveBeenCalledWith(PR_URL);
    expect(fetchPullRequest).toHaveBeenCalledTimes(1);
    expect(extractChunks).toHaveBeenCalledWith(
      "diff --git a/src/util.ts b/src/util.ts",
    );
    expect(llmReview).toHaveBeenCalledTimes(1);
    expect(llmReview).toHaveBeenCalledWith(SAMPLE_CHUNKS, expect.any(Object));
    expect(result.findings).toHaveLength(2);
    expect(result.skipped).toEqual(SAMPLE_SKIPPED);
  });

  it("recomputes counts from findings and does not pass through the model's counts", async () => {
    llmReview.mockResolvedValue(validJsonWithWrongCounts());

    const result = await review(PR_URL);

    expect(result.counts.bySeverity).toEqual({ high: 1, low: 1 });
    expect(result.counts.byCategory).toEqual({
      security: 1,
      maintainability: 1,
    });
    expect(result.counts.bySeverity.high).not.toBe(99);
  });
});

describe("review: invalid JSON triggers one repair", () => {
  it("retries exactly once with a repair prompt, then succeeds", async () => {
    llmReview
      .mockResolvedValueOnce("not json at all <<<")
      .mockResolvedValueOnce(validJsonWithWrongCounts());

    const result = await review(PR_URL);

    expect(llmReview).toHaveBeenCalledTimes(2);
    expect(llmReview.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        repair: expect.objectContaining({
          error: expect.stringMatching(/JSON parse failed/),
          raw: "not json at all <<<",
        }),
      }),
    );
    expect(result.findings).toHaveLength(2);
    expect(result.counts.bySeverity).toEqual({ high: 1, low: 1 });
  });

  it("retries once when the first payload fails schema validation", async () => {
    llmReview
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce(validJsonWithWrongCounts());

    await review(PR_URL);

    expect(llmReview).toHaveBeenCalledTimes(2);
    expect(llmReview.mock.calls[1][1].repair.error).toMatch(
      /Schema validation failed/,
    );
    expect(llmReview.mock.calls[1][1].repair.raw).toBe("{}");
  });
});

describe("review: invalid JSON on both attempts throws", () => {
  it("throws ReviewError and never attempts a second repair", async () => {
    llmReview
      .mockResolvedValueOnce("<<broken json>>")
      .mockResolvedValueOnce("<<also broken>>");

    await expect(review(PR_URL)).rejects.toThrow(ReviewError);
    expect(llmReview).toHaveBeenCalledTimes(2);
  });

  it("throws when the repair output fails schema validation", async () => {
    llmReview.mockResolvedValueOnce("{}").mockResolvedValueOnce(
      JSON.stringify({
        findings: [
          {
            file: "",
            startLine: 0,
            endLine: 0,
            severity: "x",
            category: "x",
            title: "",
            explanation: "",
            suggestion: "",
            confidence: 5,
          },
        ],
        counts: { bySeverity: {}, byCategory: {} },
      }),
    );

    await expect(review(PR_URL)).rejects.toThrow(ReviewError);
    expect(llmReview).toHaveBeenCalledTimes(2);
  });
});

describe("computeCounts", () => {
  it("counts findings by severity and category", () => {
    expect(computeCounts(SAMPLE_FINDINGS)).toEqual({
      bySeverity: { high: 1, low: 1 },
      byCategory: { security: 1, maintainability: 1 },
    });
  });

  it("returns empty maps for no findings", () => {
    expect(computeCounts([])).toEqual({
      bySeverity: {},
      byCategory: {},
    });
  });
});
