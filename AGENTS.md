# Memories — Agent Working Agreement

Read `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ENGINEERING_PRINCIPLES.md`, and `docs/SPIKE_PLAN.md` before making architectural changes.

- Do not infer that Codex or OpenCode-specific capabilities are universal. Core contracts remain agent-independent.
- Implement only the requested spike or approved milestone. Never implement deferred features proactively.
- Use strict TypeScript, Drizzle/SQLite, Zod at external boundaries, and Effect for orchestration.
- Preserve repository and user data; no unapproved edits to agent instruction files and no code modifications during read-only refresh/extraction.
- Do not assert that a checkpoint has been extracted when it is only persisted or queued.
- Preserve citations and uncertainty; do not invent file paths, line ranges, commits, or source evidence.
- Run tests and report precisely what was validated, what failed, and what remains unverified.
