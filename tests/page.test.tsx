// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Page from "@/app/page";

const SUCCESS_RESPONSE = {
  findings: [
    {
      file: "src/auth.ts",
      startLine: 10,
      endLine: 12,
      severity: "high",
      category: "security",
      title: "Hardcoded API key",
      explanation: "An API key is committed in source code.",
      suggestion: "Move the key to an environment variable.",
      confidence: 0.95,
      codeSnippet: "const API_KEY = 'sk_live_abc123';",
    },
    {
      file: "src/utils.ts",
      startLine: 5,
      endLine: 5,
      severity: "low",
      category: "maintainability",
      title: "Unused variable",
      explanation: "Variable declared but never used.",
      suggestion: "Remove the unused variable.",
      confidence: 0.8,
    },
  ],
  counts: {
    bySeverity: { high: 1, low: 1 },
    byCategory: { security: 1, maintainability: 1 },
  },
  skipped: [
    { path: "package-lock.json", reason: "lockfile" },
    { path: "dist/bundle.js", reason: "generated" },
  ],
};

const ERROR_RESPONSE = {
  error: "Invalid GitHub pull request URL: expected https://github.com/{owner}/{repo}/pull/{number}, got https://gitlab.com/a/b",
};

describe("UI: / page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn());
  });

  function getSubmitButton() {
    return screen.getByRole("button", { name: /^review$/i });
  }

  function getLoadingButton() {
    return screen.getByRole("button", { name: /reviewing.*30-90 seconds/i });
  }

  it("renders the form in idle state", () => {
    render(<Page />);

    expect(screen.getByLabelText(/pull request url/i)).toBeInTheDocument();
    expect(getSubmitButton()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reviewing/i })).not.toBeInTheDocument();
  });

  it("submits the form and shows loading state", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockImplementation(
      () => new Promise(() => {
        /* never resolves — keeps loading state */
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<Page />);

    const input = screen.getByLabelText(/pull request url/i);
    await user.type(input, "https://github.com/owner/repo/pull/42");

    await user.click(getSubmitButton());

    await waitFor(() => expect(getLoadingButton()).toBeInTheDocument());
    expect(input).toBeDisabled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("renders findings, summary, and skipped files on success", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SUCCESS_RESPONSE),
    }));

    render(<Page />);

    const input = screen.getByLabelText(/pull request url/i);
    await user.type(input, "https://github.com/owner/repo/pull/42");
    await user.click(getSubmitButton());

    await waitFor(() => expect(screen.getByText(/summary/i)).toBeInTheDocument());

    // Summary cards
    expect(screen.getByText(/total findings/i)).toBeInTheDocument();
    expect(screen.getByText(/total findings/i).parentElement).toContainHTML("2");
    expect(screen.getByText(/critical \/ high/i)).toBeInTheDocument();
    expect(screen.getByText(/critical \/ high/i).parentElement).toContainHTML("1");
    expect(screen.getByText(/correctness/i)).toBeInTheDocument();
    expect(screen.getByText("Security", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText(/security/i)[0].parentElement).toContainHTML("1");
    expect(screen.getByText("Maintainability", { exact: true })).toBeInTheDocument();
    expect(screen.getAllByText(/maintainability/i)[0].parentElement).toContainHTML("1");

    // Skipped files
    expect(screen.getByText(/skipped files/i)).toBeInTheDocument();
    expect(screen.getByText(/package-lock.json/i)).toBeInTheDocument();
    expect(screen.getByText(/lockfile/i)).toBeInTheDocument();

    // Findings grouped by file
    expect(screen.getByText(/src\/auth\.ts/i)).toBeInTheDocument();
    expect(screen.getByText(/src\/utils\.ts/i)).toBeInTheDocument();

    // Each finding has severity badge
    expect(screen.getAllByText("high", { exact: true })).toHaveLength(1);
    expect(screen.getAllByText("low", { exact: true })).toHaveLength(1);
  });

  it("clicking a finding expands to show explanation, suggestion, and code snippet", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SUCCESS_RESPONSE),
    }));

    render(<Page />);

    const input = screen.getByLabelText(/pull request url/i);
    await user.type(input, "https://github.com/owner/repo/pull/42");
    await user.click(getSubmitButton());

    await waitFor(() => expect(screen.getByText(/hardcoded api key/i)).toBeInTheDocument());

    // Click the expand button for the first finding
    const expandButtons = screen.getAllByRole("button", { name: /expand/i });
    await user.click(expandButtons[0]);

    await waitFor(() => expect(screen.getByText(/an api key is committed/i)).toBeInTheDocument());
    expect(screen.getByText(/move the key to an environment variable/i)).toBeInTheDocument();
    expect(screen.getByText(/const API_KEY = 'sk_live_abc123';/i)).toBeInTheDocument();
  });

  it("shows error state when the API returns an error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve(ERROR_RESPONSE),
    }));

    render(<Page />);

    const input = screen.getByLabelText(/pull request url/i);
    await user.type(input, "https://gitlab.com/a/b");
    await user.click(getSubmitButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/invalid github pull request url/i)).toBeInTheDocument();

    // Form should be usable again (error message shows way to try again)
    expect(screen.getByLabelText(/pull request url/i)).not.toBeDisabled();
    expect(getSubmitButton()).not.toBeDisabled();
  });

  it("shows error state when fetch fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    render(<Page />);

    const input = screen.getByLabelText(/pull request url/i);
    await user.type(input, "https://github.com/owner/repo/pull/42");
    await user.click(getSubmitButton());

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText(/network error/i)).toBeInTheDocument();
  });

  it("disables the submit button when URL is empty", () => {
    render(<Page />);

    expect(getSubmitButton()).toBeDisabled();
  });
});