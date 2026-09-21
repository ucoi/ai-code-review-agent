import { describe, expect, it } from "vitest";
import { FindingSchema, ResultSchema, type Finding, type ReviewResult } from "@/lib/schema";

describe("FindingSchema", () => {
  const valid: Finding = {
    file: "src/index.ts",
    startLine: 10,
    endLine: 15,
    severity: "high",
    category: "security",
    title: "Hardcoded secret",
    explanation: "A secret is committed to the repo.",
    suggestion: "Move the secret to an env var and rotate it.",
    confidence: 0.95,
  };

  it("accepts a valid finding", () => {
    expect(FindingSchema.parse(valid)).toMatchObject(valid);
  });

  it("accepts an optional codeSnippet", () => {
    const withSnippet = { ...valid, codeSnippet: "const x = 1;" };
    expect(FindingSchema.parse(withSnippet).codeSnippet).toBe("const x = 1;");
  });

  it("rejects a missing required field", () => {
    const { title, ...missingTitle } = valid;
    expect(() => FindingSchema.parse(missingTitle)).toThrow();
    void title;
  });

  it("rejects a bad severity", () => {
    // zod enums reject unknown values by default, so we widen the payload.
    expect(() => FindingSchema.parse({ ...valid, severity: "urgent" })).toThrow();
  });

  it("rejects a bad category", () => {
    expect(() => FindingSchema.parse({ ...valid, category: "style" })).toThrow();
  });

  it("rejects startLine > endLine", () => {
    expect(() => FindingSchema.parse({ ...valid, startLine: 20, endLine: 15 })).toThrow();
  });

  it("rejects non-positive line numbers", () => {
    expect(() => FindingSchema.parse({ ...valid, startLine: 0 })).toThrow();
    expect(() => FindingSchema.parse({ ...valid, endLine: -3 })).toThrow();
  });

  it("rejects wrong types", () => {
    expect(() => FindingSchema.parse({ ...valid, confidence: "0.9" })).toThrow();
    expect(() => FindingSchema.parse({ ...valid, startLine: "10" })).toThrow();
    expect(() => FindingSchema.parse({ ...valid, file: 42 })).toThrow();
  });

  it("rejects confidence out of range", () => {
    expect(() => FindingSchema.parse({ ...valid, confidence: 1.1 })).toThrow();
    expect(() => FindingSchema.parse({ ...valid, confidence: -0.1 })).toThrow();
  });

  it("rejects empty strings for required string fields", () => {
    expect(() => FindingSchema.parse({ ...valid, file: "" })).toThrow();
    expect(() => FindingSchema.parse({ ...valid, title: "" })).toThrow();
  });
});

describe("ResultSchema", () => {
  it("accepts a valid result", () => {
    const result: ReviewResult = {
      findings: [
        {
          file: "a.ts",
          startLine: 1,
          endLine: 1,
          severity: "low",
          category: "maintainability",
          title: "T",
          explanation: "E",
          suggestion: "S",
          confidence: 0.5,
        },
      ],
      counts: {
        bySeverity: { low: 1 },
        byCategory: { maintainability: 1 },
      },
    };
    expect(ResultSchema.parse(result)).toMatchObject(result);
  });

  it("rejects a counts key that is not a valid severity", () => {
    expect(() =>
      ResultSchema.parse({
        findings: [],
        counts: {
          bySeverity: { urgent: 1 },
          byCategory: {},
        },
      }),
    ).toThrow();
  });

  it("accepts a partial counts object", () => {
    const result = {
      findings: [],
      counts: {
        bySeverity: { high: 2 },
        byCategory: { security: 2 },
      },
    };
    expect(ResultSchema.parse(result)).toMatchObject(result);
  });
});
