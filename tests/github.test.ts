import { describe, expect, it } from "vitest";
import {
  GithubError,
  fetchPullRequest,
  parsePullRequestUrl,
  type FetchFn,
} from "@/lib/github";

const VALID_URL = "https://github.com/octocat/Hello-World/pull/1347";
const API_URL = "https://api.github.com/repos/octocat/Hello-World/pulls/1347";

const PR_JSON = {
  number: 1347,
  title: "New visual design",
  body: "Updates the homepage.",
  state: "open",
  html_url: VALID_URL,
  user: { login: "octocat" },
  base: { ref: "master", sha: "base-sha" },
  head: { ref: "new-design", sha: "head-sha" },
  changed_files: 5,
  additions: 10,
  deletions: 2,
};

const PR_DIFF = [
  "diff --git a/README.md b/README.md",
  "index 1111111..2222222 100644",
  "--- a/README.md",
  "+++ b/README.md",
  "@@ -1,3 +1,4 @@",
  " Hello",
  "+World",
  " ",
].join("\n");

describe("parsePullRequestUrl", () => {
  it("parses a canonical GitHub pull request URL", () => {
    expect(parsePullRequestUrl(VALID_URL)).toEqual({
      owner: "octocat",
      repo: "Hello-World",
      number: 1347,
    });
  });

  it("parses URLs with a trailing slash, subpath, query, or hash", () => {
    const expected = { owner: "octocat", repo: "Hello-World", number: 1347 };
    expect(parsePullRequestUrl(`${VALID_URL}/`)).toEqual(expected);
    expect(parsePullRequestUrl(`${VALID_URL}/files`)).toEqual(expected);
    expect(parsePullRequestUrl(`${VALID_URL}/commits`)).toEqual(expected);
    expect(parsePullRequestUrl(`${VALID_URL}?diff=split`)).toEqual(expected);
    expect(parsePullRequestUrl(`${VALID_URL}#discussion_r1`)).toEqual(expected);
  });

  it("parses http and www hosts", () => {
    expect(parsePullRequestUrl("http://www.github.com/acme/api/pull/9")).toEqual({
      owner: "acme",
      repo: "api",
      number: 9,
    });
  });

  it("rejects an empty string", () => {
    expect(() => parsePullRequestUrl("")).toThrow(GithubError);
    expect(() => parsePullRequestUrl("")).toThrow(/Invalid GitHub pull request URL/);
  });

  it("rejects a non-GitHub URL", () => {
    expect(() => parsePullRequestUrl("https://gitlab.com/octocat/Hello-World/pull/1")).toThrow(
      /Invalid GitHub pull request URL/,
    );
  });

  it("rejects a repository URL with no pull number", () => {
    expect(() => parsePullRequestUrl("https://github.com/octocat/Hello-World")).toThrow(
      /Invalid GitHub pull request URL/,
    );
  });

  it("rejects an issues URL", () => {
    expect(() => parsePullRequestUrl("https://github.com/octocat/Hello-World/issues/1347")).toThrow(
      /Invalid GitHub pull request URL/,
    );
  });

  it("rejects a non-numeric pull number", () => {
    expect(() => parsePullRequestUrl("https://github.com/octocat/Hello-World/pull/abc")).toThrow(
      /Invalid GitHub pull request URL/,
    );
  });

  it("rejects pull number 0", () => {
    expect(() => parsePullRequestUrl("https://github.com/octocat/Hello-World/pull/0")).toThrow(
      /Invalid GitHub pull request URL/,
    );
  });
});

describe("fetchPullRequest", () => {
  it("fetches metadata then the unified diff with the GitHub diff Accept header", async () => {
    const calls: Array<{ url: string; accept: string | null; authorization: string | null }> = [];
    const fetchMock = makeFetch((url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        accept: headers.get("Accept"),
        authorization: headers.get("Authorization"),
      });
      if (headers.get("Accept") === "application/vnd.github.diff") {
        return jsonOrText(PR_DIFF, "text/plain");
      }
      return jsonOrText(JSON.stringify(PR_JSON), "application/json");
    });

    const payload = await fetchPullRequest(VALID_URL, { fetch: fetchMock });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      url: API_URL,
      accept: "application/vnd.github+json",
      authorization: null,
    });
    expect(calls[1]).toMatchObject({
      url: API_URL,
      accept: "application/vnd.github.diff",
      authorization: null,
    });
    expect(payload.ref).toEqual({ owner: "octocat", repo: "Hello-World", number: 1347 });
    expect(payload.metadata.title).toBe("New visual design");
    expect(payload.metadata.base).toEqual({ ref: "master", sha: "base-sha" });
    expect(payload.diff).toBe(PR_DIFF);
  });

  it("sends a Bearer token from options without logging it", async () => {
    const token = "ghp_test_token_do_not_log";
    const fetchMock = makeFetch((_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
      if (headers.get("Accept") === "application/vnd.github.diff") {
        return jsonOrText(PR_DIFF, "text/plain");
      }
      return jsonOrText(JSON.stringify(PR_JSON), "application/json");
    });

    await fetchPullRequest(VALID_URL, { fetch: fetchMock, token });
  });

  it("sends GITHUB_TOKEN from the environment when options.token is omitted", async () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "ghp_env_token_do_not_log";
    try {
      const fetchMock = makeFetch((_url, init) => {
        const headers = new Headers(init?.headers);
        expect(headers.get("Authorization")).toBe("Bearer ghp_env_token_do_not_log");
        if (headers.get("Accept") === "application/vnd.github.diff") {
          return jsonOrText(PR_DIFF, "text/plain");
        }
        return jsonOrText(JSON.stringify(PR_JSON), "application/json");
      });
      await fetchPullRequest(VALID_URL, { fetch: fetchMock });
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = previous;
      }
    }
  });

  it("throws a clear error on a non-OK GitHub response without echoing the token", async () => {
    const token = "ghp_secret_should_never_appear";
    const fetchMock = makeFetch(() => new Response("nope", { status: 404, statusText: "Not Found" }));

    await expect(fetchPullRequest(VALID_URL, { fetch: fetchMock, token })).rejects.toMatchObject({
      name: "GithubError",
      status: 404,
    });

    try {
      await fetchPullRequest(VALID_URL, { fetch: fetchMock, token });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/404/);
      expect(message).not.toContain(token);
      expect(message).not.toMatch(/Bearer /);
    }
  });

  it("rejects a malformed URL before calling fetch", async () => {
    const fetchMock = makeFetch(() => {
      throw new Error("network should not be used");
    });
    await expect(
      fetchPullRequest("https://github.com/octocat/Hello-World", { fetch: fetchMock }),
    ).rejects.toThrow(/Invalid GitHub pull request URL/);
  });
});

function makeFetch(
  handler: (url: string, init?: RequestInit) => Response,
): FetchFn {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  };
}

function jsonOrText(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}
