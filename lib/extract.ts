/**
 * Unified-diff extraction.
 *
 * Turns raw `application/vnd.github.diff` text into one chunk per reviewable
 * file. The contract that matters downstream:
 *
 *   - Every added line carries its **new-file** line number. Review findings
 *     anchor to those numbers (and only those), so they can be posted back to
 *     GitHub as inline comments on the PR's new revision.
 *   - Removed lines are kept in the chunk so the model can see what was
 *     replaced, but they have `newLine: null` and are never anchor targets.
 *   - Files that are noise (lockfiles, generated, minified, binary) are
 *     reported in `skipped` instead of `chunks`.
 */

export type LineKind = "context" | "added" | "removed";

export type FileStatus = "added" | "modified" | "renamed" | "deleted";

export type SkipReason = "lockfile" | "minified" | "binary" | "generated";

export type DiffLine = {
  kind: LineKind;
  /** Line content without the leading diff marker. */
  content: string;
  /** 1-based line number in the old file; null for added lines. */
  oldLine: number | null;
  /** 1-based line number in the new file; null for removed lines. */
  newLine: number | null;
};

export type Hunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  /** Text after the closing `@@`, if the hunk header carried one. */
  section: string | null;
  lines: DiffLine[];
  /** New-file line numbers of added lines in this hunk. Anchor points. */
  addedLineNumbers: number[];
};

export type Chunk = {
  /** Real path in the new revision (the old path for deletions). */
  path: string;
  /** Previous path, set only for renames. */
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  /** All hunk lines flattened, in diff order. */
  lines: DiffLine[];
  /** New-file line numbers of added lines across all hunks. Anchor points. */
  addedLineNumbers: number[];
};

export type SkippedFile = {
  path: string;
  reason: SkipReason;
};

export type Extraction = {
  chunks: Chunk[];
  skipped: SkippedFile[];
};

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "composer.lock",
  "gemfile.lock",
  "cargo.lock",
  "poetry.lock",
  "pdm.lock",
  "uv.lock",
  "pipfile.lock",
  "go.sum",
  "flake.lock",
  "packages.lock.json",
  "mix.lock",
]);

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "tiff",
  "psd",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
  "jar",
  "war",
  "class",
  "exe",
  "dll",
  "so",
  "dylib",
  "o",
  "a",
  "bin",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "wav",
  "ogg",
  "webm",
  "sqlite",
  "db",
  "parquet",
]);

const MINIFIED_PATTERN = /\.min\.(?:js|mjs|cjs|css)$/i;

const GENERATED_DIR_SEGMENTS = new Set([
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__generated__",
  "node_modules",
]);

const GENERATED_PATTERNS = [
  /\.generated\.[^/]+$/i,
  /\.pb\.go$/i,
  /_pb2\.py$/i,
  /_pb2_grpc\.py$/i,
  /\.snap$/i,
];

const HUNK_HEADER_PATTERN =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function extractChunks(diff: string): Extraction {
  const chunks: Chunk[] = [];
  const skipped: SkippedFile[] = [];

  for (const block of splitIntoFileBlocks(diff)) {
    const parsed = parseFileBlock(block);
    if (!parsed) continue;

    const skipReason = classifySkip(parsed.path, parsed.binary);
    if (skipReason) {
      skipped.push({ path: parsed.path, reason: skipReason });
      continue;
    }

    chunks.push({
      path: parsed.path,
      oldPath: parsed.oldPath,
      status: parsed.status,
      binary: false,
      hunks: parsed.hunks,
      lines: parsed.hunks.flatMap((hunk) => hunk.lines),
      addedLineNumbers: parsed.hunks.flatMap((hunk) => hunk.addedLineNumbers),
    });
  }

  return { chunks, skipped };
}

/**
 * A unified diff may or may not start with `diff --git` headers. Split on
 * those when present; otherwise treat the whole input as a single block.
 */
function splitIntoFileBlocks(diff: string): string[][] {
  const lines = diff.split("\n");
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) blocks.push(current);
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  if (blocks.length === 0 && diff.includes("+++ ")) {
    return [lines];
  }

  return blocks;
}

type ParsedBlock = {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
};

function parseFileBlock(block: string[]): ParsedBlock | null {
  const header = block[0] ?? "";
  const headerPaths = parseGitHeaderPaths(header);

  let oldPathRaw: string | null = null;
  let newPathRaw: string | null = null;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let isNew = false;
  let isDeleted = false;
  let binary = false;

  const hunks: Hunk[] = [];
  let index = 1;

  while (index < block.length) {
    const line = block[index];

    if (line.startsWith("@@")) {
      const { hunk, nextIndex } = parseHunk(block, index);
      if (hunk) hunks.push(hunk);
      index = nextIndex;
      continue;
    }

    if (line.startsWith("--- ")) {
      oldPathRaw = normalizePath(line.slice(4));
    } else if (line.startsWith("+++ ")) {
      newPathRaw = normalizePath(line.slice(4));
    } else if (line.startsWith("rename from ")) {
      renameFrom = line.slice("rename from ".length).trim();
    } else if (line.startsWith("rename to ")) {
      renameTo = line.slice("rename to ".length).trim();
    } else if (line.startsWith("copy from ")) {
      renameFrom = line.slice("copy from ".length).trim();
    } else if (line.startsWith("copy to ")) {
      renameTo = line.slice("copy to ".length).trim();
    } else if (line.startsWith("new file mode")) {
      isNew = true;
    } else if (line.startsWith("deleted file mode")) {
      isDeleted = true;
    } else if (
      line.startsWith("Binary files ") ||
      line === "GIT binary patch"
    ) {
      binary = true;
    }

    index += 1;
  }

  let status: FileStatus = "modified";
  let path: string;

  if (isDeleted) {
    status = "deleted";
    path = oldPathRaw ?? headerPaths.a ?? "";
  } else if (renameTo) {
    status = "renamed";
    path = renameTo;
  } else if (isNew) {
    status = "added";
    path = newPathRaw ?? headerPaths.b ?? "";
  } else {
    path = newPathRaw ?? headerPaths.b ?? oldPathRaw ?? headerPaths.a ?? "";
  }

  if (!path) return null;

  const oldPath =
    status === "renamed" ? (renameFrom ?? oldPathRaw ?? null) : null;

  return { path, oldPath, status, binary, hunks };
}

function parseHunk(
  block: string[],
  startIndex: number,
): { hunk: Hunk | null; nextIndex: number } {
  const header = block[startIndex];
  const match = HUNK_HEADER_PATTERN.exec(header);

  if (!match) {
    return { hunk: null, nextIndex: startIndex + 1 };
  }

  const oldStart = Number(match[1]);
  const oldCount = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newCount = match[4] === undefined ? 1 : Number(match[4]);
  const section = match[5] ? match[5].trim() || null : null;

  const lines: DiffLine[] = [];
  const addedLineNumbers: number[] = [];

  let oldLine = oldStart;
  let newLine = newStart;
  let index = startIndex + 1;

  while (index < block.length) {
    const raw = block[index];

    // An empty string means we ran past the block (trailing split artifact).
    if (raw === "") break;

    const marker = raw[0];

    // "\ No newline at end of file" is metadata, not a line — it must not
    // consume a line number.
    if (marker === "\\") {
      index += 1;
      continue;
    }

    if (marker === " ") {
      lines.push({ kind: "context", content: raw.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else if (marker === "-") {
      lines.push({
        kind: "removed",
        content: raw.slice(1),
        oldLine,
        newLine: null,
      });
      oldLine += 1;
    } else if (marker === "+") {
      lines.push({ kind: "added", content: raw.slice(1), oldLine: null, newLine });
      addedLineNumbers.push(newLine);
      newLine += 1;
    } else {
      // Anything else (next hunk header, metadata, next file) ends the hunk.
      break;
    }

    index += 1;
  }

  return {
    hunk: {
      header,
      oldStart,
      oldCount,
      newStart,
      newCount,
      section,
      lines,
      addedLineNumbers,
    },
    nextIndex: index,
  };
}

function classifySkip(path: string, binary: boolean): SkipReason | null {
  const base = path.split("/").pop()?.toLowerCase() ?? "";

  if (LOCKFILES.has(base)) return "lockfile";
  if (MINIFIED_PATTERN.test(base)) return "minified";

  const extension = base.includes(".") ? base.split(".").pop() ?? "" : "";
  if (BINARY_EXTENSIONS.has(extension)) return "binary";
  if (binary) return "binary";

  if (GENERATED_PATTERNS.some((pattern) => pattern.test(path))) {
    return "generated";
  }

  const segments = path.split("/").slice(0, -1).map((part) => part.toLowerCase());
  if (segments.some((part) => GENERATED_DIR_SEGMENTS.has(part))) {
    return "generated";
  }

  return null;
}

function parseGitHeaderPaths(line: string): { a?: string; b?: string } {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return {};

  const rest = line.slice(prefix.length);
  const separator = rest.lastIndexOf(" b/");
  if (separator === -1) return {};

  const rawA = rest.slice(0, separator);
  const rawB = rest.slice(separator + 1);

  return {
    a: stripQuotes(stripPrefix(rawA, "a/")),
    b: stripQuotes(stripPrefix(rawB, "b/")),
  };
}

/** `+++ b/src/x.ts` -> `src/x.ts`; `/dev/null` -> null. */
function normalizePath(raw: string): string | null {
  const withoutTimestamp = raw.split("\t")[0].trim();
  if (!withoutTimestamp || withoutTimestamp === "/dev/null") return null;

  const unquoted = stripQuotes(withoutTimestamp);
  if (unquoted.startsWith("a/")) return stripPrefix(unquoted, "a/");
  if (unquoted.startsWith("b/")) return stripPrefix(unquoted, "b/");
  return unquoted;
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}
