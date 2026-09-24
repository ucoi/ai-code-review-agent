import { GithubError, parsePullRequestUrl } from "@/lib/github";
import { LlmError } from "@/lib/llm";
import { review, ReviewError } from "@/lib/review";

/**
 * POST /api/review
 *
 * Body: { "prUrl": "https://github.com/{owner}/{repo}/pull/{number}" }
 *
 * Server-side only. LLM_API_KEY / GITHUB_TOKEN are read from the environment
 * inside lib/llm.ts and lib/github.ts — they never appear in the response.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Request body must be valid JSON.");
  }

  const prUrl = extractPrUrl(body);
  if (prUrl === null) {
    return jsonError(
      400,
      'Missing or invalid "prUrl". Expected a GitHub pull request URL.',
    );
  }

  try {
    parsePullRequestUrl(prUrl);
  } catch (error) {
    if (error instanceof GithubError) {
      return jsonError(400, error.message);
    }
    return jsonError(400, "Invalid GitHub pull request URL.");
  }

  try {
    const result = await review(prUrl);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return mapReviewFailure(error);
  }
}

function extractPrUrl(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const prUrl = (body as { prUrl?: unknown }).prUrl;
  if (typeof prUrl !== "string") return null;
  const trimmed = prUrl.trim();
  return trimmed === "" ? null : trimmed;
}

function mapReviewFailure(error: unknown): Response {
  if (error instanceof GithubError) {
    const status = error.status === 404 ? 404 : 400;
    return jsonError(status, error.message);
  }
  if (error instanceof ReviewError || error instanceof LlmError) {
    return jsonError(500, error.message);
  }
  return jsonError(500, "An unexpected error occurred during review.");
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: sanitize(message) }, { status });
}

/** Strip anything that looks like a secret before it can leave the server. */
function sanitize(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(LLM_API_KEY|GITHUB_TOKEN|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}
