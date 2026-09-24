import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubError } from "@/lib/github";
import { LlmError } from "@/lib/llm";

const reviewMock = vi.fn();

vi.mock("@/lib/review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/review")>();
  return {
    ...actual,
    review: (...args: unknown[]) => reviewMock(...args),
  };
});

const { POST } = await import("@/app/api/review/route");
const { ReviewError } = await import("@/lib/review");

const VALID_PR_URL = "https://github.com/octocat/Hello-World/pull/1";

const SUCCESS_RESULT = {
  findings: [
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
  ],
  counts: {
    bySeverity: { high: 1 },
    byCategory: { security: 1 },
  },
  skipped: [{ path: "package-lock.json", reason: "lockfile" }],
};

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/review", () => {
  beforeEach(() => {
    reviewMock.mockReset();
    reviewMock.mockResolvedValue(SUCCESS_RESULT);
  });

  it("valid request calls review and returns 200 with findings + skipped", async () => {
    const response = await POST(jsonRequest({ prUrl: VALID_PR_URL }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUCCESS_RESULT);
    expect(reviewMock).toHaveBeenCalledTimes(1);
    expect(reviewMock).toHaveBeenCalledWith(VALID_PR_URL);
  });

  it("missing prUrl returns 400 without calling review", async () => {
    const response = await POST(jsonRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: expect.stringMatching(/prUrl/),
    });
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("malformed prUrl returns 400 without calling review", async () => {
    const response = await POST(
      jsonRequest({ prUrl: "https://gitlab.com/octocat/Hello-World/pull/1" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/Invalid GitHub pull request URL/),
    });
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("blank prUrl is treated as missing", async () => {
    const response = await POST(jsonRequest({ prUrl: "   " }));

    expect(response.status).toBe(400);
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("malformed JSON body returns 400 without calling review", async () => {
    const response = await POST(
      new Request("http://localhost/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "<<not json>>",
      }),
    );

    expect(response.status).toBe(400);
    expect(reviewMock).not.toHaveBeenCalled();
  });

  it("maps a GithubError 404 from review to HTTP 404", async () => {
    reviewMock.mockRejectedValue(
      new GithubError("GitHub API request failed (404 Not Found) for octocat/Hello-World#1", 404),
    );

    const response = await POST(jsonRequest({ prUrl: VALID_PR_URL }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "GitHub API request failed (404 Not Found) for octocat/Hello-World#1",
    });
  });

  it("maps a GithubError without a status to HTTP 400", async () => {
    reviewMock.mockRejectedValue(
      new GithubError("GitHub API request failed (403 Forbidden) for octocat/Hello-World#1", 403),
    );

    const response = await POST(jsonRequest({ prUrl: VALID_PR_URL }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toMatch(/403 Forbidden/);
    expect(payload).not.toHaveProperty("stack");
  });

  it("maps a ReviewError to HTTP 500 with no leaked internals", async () => {
    reviewMock.mockRejectedValue(
      new ReviewError("LLM output was invalid after one repair attempt. Last error: JSON parse failed"),
    );

    const response = await POST(jsonRequest({ prUrl: VALID_PR_URL }));

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toEqual({
      error: "LLM output was invalid after one repair attempt. Last error: JSON parse failed",
    });
    expect(JSON.stringify(payload)).not.toMatch(/stack/i);
  });

  it("maps an LlmError to HTTP 500 without leaking an API key", async () => {
    reviewMock.mockRejectedValue(
      new LlmError("Missing LLM_API_KEY. Set LLM_API_KEY (and optionally LLM_BASE_URL / LLM_MODEL) in your environment."),
    );

    const response = await POST(jsonRequest({ prUrl: VALID_PR_URL }));

    expect(response.status).toBe(500);
    const body = JSON.stringify(await response.json());
    expect(body).toMatch(/Missing LLM_API_KEY/);
    expect(body).not.toContain("sk-");
    expect(body).not.toMatch(/Bearer /);
  });

  it("maps an unexpected error to a generic 500", async () => {
    reviewMock.mockRejectedValue(new Error("boom"));

    const response = await POST(jsonRequest({ prUrl: VALID_PR_URL }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "An unexpected error occurred during review.",
    });
  });
});
