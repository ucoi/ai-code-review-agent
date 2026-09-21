const GITHUB_API = "https://api.github.com";
const JSON_ACCEPT = "application/vnd.github+json";
const DIFF_ACCEPT = "application/vnd.github.diff";
const API_VERSION = "2022-11-28";
const USER_AGENT = "ai-code-review-agent";

/**
 * GitHub pull-request URLs we accept:
 *   https://github.com/{owner}/{repo}/pull/{number}
 * Optional trailing path (`/files`, `/commits`), query, or hash.
 */
const PR_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/i;

export type PullRequestRef = {
  owner: string;
  repo: string;
  number: number;
};

export type PullRequestMetadata = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string;
  userLogin: string | null;
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  changedFiles: number | null;
  additions: number | null;
  deletions: number | null;
};

export type PullRequestPayload = {
  ref: PullRequestRef;
  metadata: PullRequestMetadata;
  diff: string;
};

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type GithubOptions = {
  /** Injected fetch. Defaults to global fetch. Tests must pass a mock. */
  fetch?: FetchFn;
  /** Overrides GITHUB_TOKEN. Empty / omitted means unauthenticated. */
  token?: string;
};

export class GithubError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

export function parsePullRequestUrl(url: string): PullRequestRef {
  const trimmed = url.trim();
  const match = PR_URL_PATTERN.exec(trimmed);
  if (!match) {
    throw new GithubError(
      `Invalid GitHub pull request URL: expected https://github.com/{owner}/{repo}/pull/{number}, got ${summarizeInput(trimmed)}`,
    );
  }

  const owner = match[1];
  const repo = match[2];
  const number = Number(match[3]);

  if (!owner || !repo || !Number.isInteger(number) || number < 1) {
    throw new GithubError(
      `Invalid GitHub pull request URL: expected https://github.com/{owner}/{repo}/pull/{number}, got ${summarizeInput(trimmed)}`,
    );
  }

  return { owner, repo, number };
}

export async function fetchPullRequest(
  urlOrRef: string | PullRequestRef,
  options: GithubOptions = {},
): Promise<PullRequestPayload> {
  const ref =
    typeof urlOrRef === "string" ? parsePullRequestUrl(urlOrRef) : urlOrRef;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const token = resolveToken(options.token);
  const endpoint = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${ref.number}`;

  const metadataResponse = await request(fetchFn, endpoint, JSON_ACCEPT, token, ref);
  const raw = (await metadataResponse.json()) as GitHubPullJson;
  const metadata = mapMetadata(ref, raw);

  const diffResponse = await request(fetchFn, endpoint, DIFF_ACCEPT, token, ref);
  const diff = await diffResponse.text();

  return { ref, metadata, diff };
}

function resolveToken(explicit: string | undefined): string | undefined {
  const value = explicit ?? process.env.GITHUB_TOKEN;
  return value ? value : undefined;
}

function requestHeaders(accept: string, token: string | undefined): Headers {
  const headers = new Headers({
    Accept: accept,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function request(
  fetchFn: FetchFn,
  url: string,
  accept: string,
  token: string | undefined,
  ref: PullRequestRef,
): Promise<Response> {
  const response = await fetchFn(url, {
    method: "GET",
    headers: requestHeaders(accept, token),
  });

  if (!response.ok) {
    throw new GithubError(
      `GitHub API request failed (${response.status} ${response.statusText}) for ${ref.owner}/${ref.repo}#${ref.number}`,
      response.status,
    );
  }

  return response;
}

function summarizeInput(value: string): string {
  if (!value) return "<empty>";
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

type GitHubPullJson = {
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  html_url?: string;
  user?: { login?: string } | null;
  base?: { ref?: string; sha?: string };
  head?: { ref?: string; sha?: string };
  changed_files?: number;
  additions?: number;
  deletions?: number;
};

function mapMetadata(ref: PullRequestRef, raw: GitHubPullJson): PullRequestMetadata {
  return {
    owner: ref.owner,
    repo: ref.repo,
    number: raw.number ?? ref.number,
    title: raw.title ?? "",
    body: raw.body ?? null,
    state: raw.state ?? "unknown",
    htmlUrl: raw.html_url ?? `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    userLogin: raw.user?.login ?? null,
    base: { ref: raw.base?.ref ?? "", sha: raw.base?.sha ?? "" },
    head: { ref: raw.head?.ref ?? "", sha: raw.head?.sha ?? "" },
    changedFiles: raw.changed_files ?? null,
    additions: raw.additions ?? null,
    deletions: raw.deletions ?? null,
  };
}
