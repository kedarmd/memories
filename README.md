# Memories

A local-first, agent-agnostic memory system for coding sessions and software projects.

> **Status:** Foundation and feasibility-spike planning. Not a functional memory application yet.

## What lives here

- [`docs/PRD.md`](docs/PRD.md): approved direction and V1 workflows
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): boundaries and proposed technical design
- [`docs/ENGINEERING_PRINCIPLES.md`](docs/ENGINEERING_PRINCIPLES.md): engineering guardrails
- [`docs/SPIKE_PLAN.md`](docs/SPIKE_PLAN.md): experiments and pass/fail criteria
- [`AGENTS.md`](AGENTS.md): instructions for coding agents working in this repository

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run check
npm test
npm run build
```

The initial scaffold intentionally has no running service, database, CLI, agent adapter, or frontend. Those are introduced only after the feasibility experiments establish their required contracts.

## Constraints

- Core storage and retrieval must not depend on a specific coding harness.
- Work only within the reviewed V1 scope and named feasibility experiment.
- Keep source provenance, data integrity, and user control explicit.
