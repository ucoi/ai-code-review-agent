import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractChunks, type Chunk, type DiffLine } from "@/lib/extract";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

function onlyChunk(diff: string): Chunk {
  const { chunks } = extractChunks(diff);
  expect(chunks).toHaveLength(1);
  return chunks[0];
}

function addedAnchors(diff: string, filePath: string): number[] {
  const chunk = extractChunks(diff).chunks.find((c) => c.path === filePath);
  if (!chunk) throw new Error(`no chunk for ${filePath}`);
  return chunk.addedLineNumbers;
}

describe("line numbers: added line after a deletion", () => {
  const chunk = onlyChunk(fixture("deletion-shift.diff"));

  it("resolves the real file path and status", () => {
    expect(chunk.path).toBe("src/app.ts");
    expect(chunk.status).toBe("modified");
    expect(chunk.oldPath).toBeNull();
  });

  it("anchors the added lines to new-file numbers, not shifted by the deletion", () => {
    // `-const PORT = 3000;` is removed, so the two additions land on new
    // lines 2 and 3 — the deletion must not push them to 3 and 4.
    expect(chunk.addedLineNumbers).toEqual([2, 3]);
  });

  it("keeps the deleted line in the chunk, marked removed with no new-file number", () => {
    const removed = chunk.lines.filter((line) => line.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({
      content: "const PORT = 3000;",
      oldLine: 2,
      newLine: null,
    });
  });

  it("numbers added lines and context lines on the new-file track", () => {
    expect(chunk.lines.map((line) => [line.kind, line.newLine])).toEqual([
      ["context", 1],
      ["removed", null],
      ["added", 2],
      ["added", 3],
      ["context", 4],
      ["context", 5],
      ["context", 6],
    ]);
  });

  it("keeps removed lines on the old-file track", () => {
    expect(chunk.lines.map((line) => line.oldLine)).toEqual([
      1, 2, null, null, 3, 4, 5,
    ]);
  });
});

describe("line numbers: added lines across multiple hunks", () => {
  const chunk = onlyChunk(fixture("multi-hunk.diff"));

  it("parses both hunks with their own new-file start", () => {
    expect(chunk.hunks).toHaveLength(2);
    expect(chunk.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(chunk.hunks[1]).toMatchObject({ oldStart: 20, newStart: 21 });
  });

  it("anchors additions in each hunk to that hunk's new-file numbering", () => {
    expect(chunk.hunks[0].addedLineNumbers).toEqual([2, 3]);
    expect(chunk.hunks[1].addedLineNumbers).toEqual([24]);
    expect(chunk.addedLineNumbers).toEqual([2, 3, 24]);
  });

  it("numbers the second hunk from its own header start", () => {
    expect(chunk.hunks[1].lines.map((line) => line.newLine)).toEqual([
      21,
      22,
      23,
      null,
      24,
    ]);
  });

  it("only ever anchors to new-file line numbers that addition lines carry", () => {
    const anchors = new Set(chunk.addedLineNumbers);
    const carried = chunk.lines
      .filter((line) => line.kind === "added")
      .map((line) => line.newLine);
    expect(carried).toEqual([...anchors]);
    for (const line of chunk.lines) {
      if (line.newLine !== null && anchors.has(line.newLine)) {
        expect(line.kind).not.toBe("removed");
      }
    }
  });
});

describe("renamed files", () => {
  const chunk = onlyChunk(fixture("renamed.diff"));

  it("uses the new path and records the previous one", () => {
    expect(chunk.path).toBe("src/new-name.ts");
    expect(chunk.oldPath).toBe("src/old-name.ts");
    expect(chunk.status).toBe("renamed");
  });

  it("anchors additions to the new file's line numbers", () => {
    expect(chunk.addedLineNumbers).toEqual([2]);
    const added = chunk.lines.find((line) => line.kind === "added");
    expect(added?.content).toBe('export const alias = "new";');
    expect(added?.newLine).toBe(2);
  });
});

describe("skipped file types", () => {
  const { chunks, skipped } = extractChunks(fixture("skipped.diff"));

  it("keeps only the reviewable file", () => {
    expect(chunks.map((chunk) => chunk.path)).toEqual(["src/kept.ts"]);
    expect(addedAnchors(fixture("skipped.diff"), "src/kept.ts")).toEqual([2]);
  });

  it("reports each skipped file with its reason", () => {
    expect(skipped).toEqual([
      { path: "package-lock.json", reason: "lockfile" },
      { path: "public/app.min.js", reason: "minified" },
      { path: "public/logo.png", reason: "binary" },
      { path: "dist/bundle.js", reason: "generated" },
    ]);
  });
});

describe("edge cases that must not shift line numbers", () => {
  it("ignores \\ No newline at end of file markers", () => {
    const chunk = onlyChunk(fixture("no-newline.diff"));
    expect(chunk.addedLineNumbers).toEqual([2, 3]);
    expect(chunk.lines.map((line) => [line.kind, line.newLine])).toEqual([
      ["context", 1],
      ["removed", null],
      ["added", 2],
      ["added", 3],
    ]);
  });

  it("treats a blank context line as a context line", () => {
    const chunk = onlyChunk(fixture("blank-context.diff"));
    expect(chunk.addedLineNumbers).toEqual([3]);
    const blank = chunk.lines[1] as DiffLine;
    expect(blank).toMatchObject({ kind: "context", content: "", newLine: 2 });
  });

  it("handles a deleted file by taking the path from the old side", () => {
    const chunk = onlyChunk(fixture("deleted-file.diff"));
    expect(chunk.path).toBe("src/legacy.ts");
    expect(chunk.status).toBe("deleted");
    expect(chunk.addedLineNumbers).toEqual([]);
    expect(chunk.lines.every((line) => line.kind === "removed")).toBe(true);
  });

  it("returns empty results for an empty diff without throwing", () => {
    expect(extractChunks("")).toEqual({ chunks: [], skipped: [] });
  });
});
