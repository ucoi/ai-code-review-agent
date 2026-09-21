import { describe, expect, it } from "vitest";

/**
 * Toolchain smoke test.
 *
 * This does not test product logic — it proves the Vitest harness itself is
 * wired correctly (TS transform, node environment, path alias, test glob) so
 * that later batches can add real specs without wondering whether a failure
 * is the code or the config.
 */
describe("toolchain", () => {
  it("runs TypeScript specs", () => {
    const value: number = 1 + 1;
    expect(value).toBe(2);
  });

  it("resolves the @ path alias to the project root", async () => {
    const pkg = await import("@/package.json");
    expect(pkg.default.name).toBe("ai-code-review-agent");
  });
});
