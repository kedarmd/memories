# Memories — Agent Working Agreement

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ENGINEERING_PRINCIPLES.md`, `docs/SPIKE_PLAN.md`, and `docs/IMPLEMENTATION_PLAN.md` before making architectural changes.

## Engineering boundaries

- Do not infer that Codex or OpenCode-specific capabilities are universal. Core contracts remain agent-independent.
- Implement only the requested spike or approved milestone. Never implement deferred features proactively.
- Use strict TypeScript, Drizzle/SQLite, Zod at external boundaries, and Effect for orchestration.
- Preserve repository and user data; no unapproved edits to agent instruction files and no code modifications during read-only refresh/extraction.
- Do not assert that a checkpoint has been extracted when it is only persisted or queued.
- Preserve citations and uncertainty; do not invent file paths, line ranges, commits, or source evidence.
- Run tests and report precisely what was validated, what failed, and what remains unverified.

## Issue-driven, strictly sequential workflow

- Use GitHub Issues for approved units of work and GitHub PRs for review evidence. The roadmap is `docs/IMPLEMENTATION_PLAN.md`; do not maintain a duplicate progress tracker.
- Only start work after the owner explicitly selects/approves an issue. The existence of an issue or a milestone is not authorization.
- Work on **one issue at a time**. If its PR is open, revise that PR rather than starting a new implementation issue. Never begin another task until the owner merges and accepts the current work.
- Before making edits, use `gh` to verify the repo, current issue, prerequisites, and open PR state. Read referenced docs and stop if requirements conflict.
- Keep each PR scoped to its issue; include corresponding tests, evidence, limitations, and doc changes. Reference the issue in the PR using `Refs #N`; do not auto-close issues without owner confirmation.
- Codex may create branches, commits, issue drafts approved by the owner, and PRs; may suggest scope changes; and must **not** self-approve, merge PRs, close an issue as accepted, change architectural requirements without review, or silently start the next issue.
- Treat `AGENTS.md` as workflow guidance, not a security boundary. GitHub permissions and branch protection enforce permissions if needed.
