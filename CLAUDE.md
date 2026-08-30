# sakuda

## Stack & commands

Primary: TypeScript

### TypeScript (pnpm)
- Install: `pnpm install`
- Test: `pnpm test`
- Lint: `pnpm run lint`
- Typecheck: `pnpm run typecheck`
- Format: Prettier (hook on Write/Edit)


When changes touch only one ecosystem, run that ecosystem's test command, not the whole repo.

## Hard rules (enforced by hooks / CI where possible)

- Real credentials live only in `.env` (gitignored); mirror keys into `.env.example`.
  Never print secrets to logs or API responses.
- Do not push to `main` without an explicit user request.
- No destructive operations against shared or production environments —
  local and fixtures only, unless the user explicitly approves that exact command.
- CI must pass before merge. Fix the cause upstream; never relax tests, types,
  lint rules, or thresholds to make a check green.

## Design

UI/visual work (colors, typography, spacing, radius, components) must follow
`DESIGN.md` — the single source of truth for design tokens and component specs.
Reference its tokens (`{colors.ink}`, `{rounded.full}`, `{component.button-primary}`)
rather than inventing values; add new variants there before using them in code.

## Improvement cycle

Prefer the cycle over ad-hoc one-shot fixes:
Diagnose (`/yds-software-evaluation`, `/yds-vulnerability-scan`, `/yds-data-validation`)
→ Draft/Register (`/yds-gh-issue-drafter`, `/yds-report-to-issues`)
→ Plan (`/yds-gh-issue-planner`) → Resolve+Verify (`/yds-gh-issue-resolver`).

Rules live in `.claude/rules/`: the cycle contract (`dev-skills-cycle.md`),
score-aligned coding principles (`coding-principles.md` — following them is
what a high `/yds-software-evaluation` score looks like), and per-language
rules. Long workflows live in `.claude/skills/*/SKILL.md` — keep this file short.
