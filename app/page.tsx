"use client";

import { useState } from "react";
import type { PullRequestReview } from "@/lib/review";

export default function Page() {
  const [prUrl, setPrUrl] = useState("");
  const [state, setState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [result, setResult] = useState<PullRequestReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prUrl.trim()) return;

    setState("loading");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }

      const data = await response.json();
      setResult(data);
      setState("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
      setState("error");
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            AI Code Review
          </h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Paste a GitHub PR URL to get an automated code review.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="pr-url"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Pull Request URL
            </label>
            <input
              id="pr-url"
              type="url"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
              disabled={state === "loading"}
              className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            disabled={state === "loading" || !prUrl.trim()}
            className="w-full py-3 px-6 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label={state === "loading" ? "Reviewing… this may take 30-90 seconds" : "Review"}
          >
            {state === "loading" ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-5 w-5"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Reviewing… this may take 30-90 seconds
              </span>
            ) : (
              "Review"
            )}
          </button>
        </form>

        {state === "error" && (
          <div
            className="mt-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
            role="alert"
          >
            <p className="text-red-700 dark:text-red-300 font-medium">{error}</p>
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              Try again with a different URL or check the server logs.
            </p>
          </div>
        )}

        {state === "success" && result && (
          <ReviewResult result={result} />
        )}
      </div>
    </main>
  );
}

interface ReviewResultProps {
  result: PullRequestReview;
}

function ReviewResult({ result }: ReviewResultProps) {
  const total = result.findings.length;
  const bySeverity = result.counts.bySeverity;
  const byCategory = result.counts.byCategory;

  return (
    <div className="mt-8 space-y-6" role="region" aria-label="Review results">
      {/* Summary bar */}
      <section className="p-4 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Findings"
            value={total}
            color="zinc"
          />
          <SummaryCard
            label="Critical / High"
            value={(bySeverity.critical ?? 0) + (bySeverity.high ?? 0)}
            color="red"
          />
          <SummaryCard
            label="Medium"
            value={bySeverity.medium ?? 0}
            color="yellow"
          />
          <SummaryCard
            label="Low"
            value={bySeverity.low ?? 0}
            color="green"
          />
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <CategoryCard
            label="Correctness"
            value={byCategory.correctness ?? 0}
          />
          <CategoryCard
            label="Security"
            value={byCategory.security ?? 0}
          />
          <CategoryCard
            label="Performance"
            value={byCategory.performance ?? 0}
          />
          <CategoryCard
            label="Maintainability"
            value={byCategory.maintainability ?? 0}
          />
        </div>
      </section>

      {/* Skipped files */}
      {result.skipped.length > 0 && (
        <section className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Skipped Files
          </h2>
          <ul className="space-y-2">
            {result.skipped.map((file) => (
              <li key={file.path} className="flex items-center gap-3">
                <span className="px-2 py-1 text-xs font-medium rounded bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200">
                  {file.reason}
                </span>
                <code className="text-sm text-zinc-700 dark:text-zinc-300 font-mono">
                  {file.path}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Findings by file */}
      {result.findings.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Findings
          </h2>
          {Object.entries(groupByFile(result.findings)).map(([file, findings]) => (
            <FileFindings key={file} file={file} findings={findings} />
          ))}
        </section>
      ) : (
        <section className="p-6 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-center">
          <p className="text-green-700 dark:text-green-300 font-medium">
            No findings — the code looks clean!
          </p>
        </section>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "zinc" | "red" | "yellow" | "green";
}) {
  const colors = {
    zinc: "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100",
    red: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    yellow: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    green: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  };
  return (
    <div className={`p-3 rounded-lg ${colors[color]}`}>
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 uppercase tracking-wide">
        {label}
      </p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}

function CategoryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">{label}</p>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}

function groupByFile(findings: PullRequestReview["findings"]) {
  return findings.reduce(
    (acc, f) => {
      (acc[f.file] ??= []).push(f);
      return acc;
    },
    {} as Record<string, PullRequestReview["findings"]>,
  );
}

function FileFindings({
  file,
  findings,
}: {
  file: string;
  findings: PullRequestReview["findings"];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <article className="rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <header className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="font-medium text-zinc-900 dark:text-zinc-100 font-mono text-sm">
          {file}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
          {findings.length} finding{findings.length !== 1 ? "s" : ""}
        </p>
      </header>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {findings.map((finding, idx) => (
          <FindingCard
            key={`${file}-${idx}`}
            finding={finding}
            expanded={expanded === finding.title}
            onToggle={() =>
              setExpanded(expanded === finding.title ? null : finding.title)
            }
          />
        ))}
      </div>
    </article>
  );
}

function FindingCard({
  finding,
  expanded,
  onToggle,
}: {
  finding: PullRequestReview["findings"][0];
  expanded: boolean;
  onToggle: () => void;
}) {
  const severityColors = {
    critical: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    high: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
    medium: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    low: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300",
  };
  const categoryColors = {
    correctness: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    security: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    performance: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
    maintainability: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
  };

  return (
    <div className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="flex-shrink-0 w-6 h-6 rounded border border-zinc-300 dark:border-zinc-600 flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          <svg
            className={`w-4 h-4 text-zinc-600 dark:text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${severityColors[finding.severity]}`}
            >
              {finding.severity}
            </span>
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${categoryColors[finding.category]}`}
            >
              {finding.category}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              L{finding.startLine}{finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}
            </span>
          </div>
          <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
            {finding.title}
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
          <div>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Explanation
            </p>
            <p className="text-zinc-700 dark:text-zinc-300 text-sm whitespace-pre-wrap">
              {finding.explanation}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Suggestion
            </p>
            <p className="text-zinc-700 dark:text-zinc-300 text-sm whitespace-pre-wrap">
              {finding.suggestion}
            </p>
          </div>
          {finding.codeSnippet && (
            <div>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                Code Snippet
              </p>
              <pre className="p-3 rounded bg-zinc-100 dark:bg-zinc-800 overflow-x-auto text-sm font-mono text-zinc-900 dark:text-zinc-100">
                <code>{finding.codeSnippet}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}