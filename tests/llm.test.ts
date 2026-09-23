import { describe, expect, it } from "vitest";
import { LlmError, review, buildPrompt } from "@/lib/llm";
import type { Chunk } from "@/lib/extract";

const MOCK_CHUNKS: Chunk[] = [
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

function makeFetch(handler: (url: string, init?: RequestInit) => Response) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  };
}

const env = process.env as Record<string, string | undefined>;

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return run().finally(() => {
    for (const key of Object.keys(overrides)) {
      const value = previous[key];
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  });
}

describe("mock provider", () => {
  it("returns valid-shaped JSON text in test env when no API key is set", async () => {
    await withEnv(
      {
        LLM_API_KEY: undefined,
        LLM_BASE_URL: undefined,
        LLM_MODEL: undefined,
      },
      async () => {
        expect(process.env.NODE_ENV).toBe("test");
        const raw = await review(MOCK_CHUNKS);
        const parsed = JSON.parse(raw);
        expect(parsed).toHaveProperty("findings");
        expect(parsed).toHaveProperty("counts");
        expect(Array.isArray(parsed.findings)).toBe(true);
        expect(parsed.findings[0]).toMatchObject({
          file: "src/util.ts",
          severity: "low",
          category: "maintainability",
        });
      },
    );
  });
});

describe("real-path config resolution", () => {
  it("throws a clear error when LLM_API_KEY is missing outside test env", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LLM_API_KEY: undefined,
      },
      async () => {
        await expect(review(MOCK_CHUNKS)).rejects.toThrow(LlmError);
        await expect(review(MOCK_CHUNKS)).rejects.toThrow(/Missing LLM_API_KEY/);
      },
    );
  });

  it("builds the request with correct headers/body when LLM_API_KEY is set", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LLM_API_KEY: "sk_test_token_do_not_log",
        LLM_BASE_URL: "http://localhost:20128/v1",
        LLM_MODEL: "openai/gpt-4o-mini",
      },
      async () => {
        let capturedInit: RequestInit | undefined;
        let capturedUrl: string | undefined;

        const fetchMock = makeFetch((url, init) => {
          capturedUrl = url;
          capturedInit = init;
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '{"findings":[],"counts":{"bySeverity":{},"byCategory":{}}}',
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        });

        const raw = await review(MOCK_CHUNKS, { fetch: fetchMock });

        expect(capturedUrl).toBe("http://localhost:20128/v1/chat/completions");
        expect(capturedInit?.method).toBe("POST");

        const headers = new Headers(capturedInit?.headers);
        expect(headers.get("content-type")).toBe("application/json");
        expect(headers.get("authorization")).toBe(
          "Bearer sk_test_token_do_not_log",
        );

        const body = JSON.parse(capturedInit!.body as string);
        expect(body.model).toBe("openai/gpt-4o-mini");
        expect(body.stream).toBe(false);
        expect(body.messages).toHaveLength(2);
        expect(body.messages[0].role).toBe("system");
        expect(body.messages[1].role).toBe("user");
        expect(raw).toBe(
          '{"findings":[],"counts":{"bySeverity":{},"byCategory":{}}}',
        );
      },
    );
  });

  it("includes the prompt-injection instruction in the request body sent to fetch", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LLM_API_KEY: "sk_test_token_do_not_log",
        LLM_BASE_URL: "http://localhost:20128/v1",
        LLM_MODEL: "openai/gpt-4o-mini",
      },
      async () => {
        let capturedBody = "";
        const fetchMock = makeFetch((_url, init) => {
          capturedBody = String(init?.body ?? "");
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "{}" } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        });

        await review(MOCK_CHUNKS, { fetch: fetchMock });

        expect(capturedBody).toContain("attacker-controlled");
        expect(capturedBody).toContain("MUST be ignored");
        expect(capturedBody).toContain("<<<DIFF_START>>>");
        expect(capturedBody).toContain("<<<DIFF_END>>>");
        expect(capturedBody).toContain("ONLY valid JSON");
      },
    );
  });

  it("throws a clear error when the API returns a non-OK response", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LLM_API_KEY: "sk_test_token_do_not_log",
        LLM_BASE_URL: "http://localhost:20128/v1",
        LLM_MODEL: "openai/gpt-4o-mini",
      },
      async () => {
        const fetchMock = makeFetch(
          () =>
            new Response("rate limited", {
              status: 429,
              statusText: "Too Many Requests",
            }),
        );

        await expect(review(MOCK_CHUNKS, { fetch: fetchMock })).rejects.toThrow(
          LlmError,
        );
        await expect(
          review(MOCK_CHUNKS, { fetch: fetchMock }),
        ).rejects.toThrow(/429/);
      },
    );
  });
});

describe("prompt content", () => {
  it("describes the JSON schema fields without dumping Zod internals", () => {
    const [system] = buildPrompt(MOCK_CHUNKS);
    expect(system.content).toContain("findings");
    expect(system.content).toContain("counts");
    expect(system.content).toContain("severity");
    expect(system.content).toContain("confidence");
    expect(system.content).not.toContain("z.object");
    expect(system.content).not.toContain("Zod");
  });
});
