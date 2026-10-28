# AGENTS.md

Instructions for coding agents working in this repository.

## What this is

claude-color is a Claude Code mod (a plugin of function hooks). It lets Claude
colour its own replies in the terminal, using the same template syntax as the
`chalk-template` npm package: `{red text}`, `{bgRed.white text}`,
`{#ff8800 text}`.

The plugin's name is `color-replies`, not `claude-color`: Claude Code reserves
plugin names that start with `claude-`. The repository keeps its own name.

It works in two parts:

1. A `prompt.compose` hook adds a short section to the system prompt that
   teaches the model the syntax.
2. A `ui.render` hook on `AssistantMessage` finds the markup in each reply
   block and draws it with coloured `Text` elements. Blocks without markup are
   left to the engine, so they draw exactly as before.

The stored transcript keeps the raw markup. Only the drawing changes.

## Layout

| Path | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.claude-plugin/marketplace.json` | Makes the repo installable as a marketplace |
| `hooks/hooks.json` | Names the hooks module |
| `hooks/register.tsx` | The hooks: system prompt section and reply drawing |
| `hooks/markup.ts` | Pure parser: text in, styled chunks out |
| `tests/*.test.ts(x)` | Tests, run by `claude plugin test` |

The engine writes type declarations to `.claude-plugin/types/` when it loads
the mod. That folder is ignored by git.

## Checks

Run all three before every commit that touches code:

```sh
claude plugin validate .
claude plugin test .
tsc -p .
```

`tsc -p .` needs the engine's types in `.claude-plugin/types/`, which appear
once Claude Code has loaded the mod (for example with
`claude --plugin-dir .`).

The tests check the trees the hooks return, not what a terminal paints. After
a change to drawing, check a real session too: start
`claude --plugin-dir .` in a pseudo-terminal (`expect` works), ask for a
coloured reply, capture the raw output and read the SGR escape codes. Compare
with a session started without the mod for layout (the reply bullet, its
colour, indents and blank lines).

Colour values must be ones the plugin layer accepts: a chalk name (`red`,
`redBright`), a theme key, `#rrggbb` or `rgb(r,g,b)`. Forms such as
`ansi:red` are refused and the whole tree is skipped.

## Rules

- This repository is public. Never commit secrets, tokens, internal hostnames,
  internal URLs, personal data or anything copied from another project.
- Keep the mod small. No dependencies. The hooks module runs in a sandbox with
  no DOM and no Node, so everything outside it goes through `$`.
- Keep `hooks/markup.ts` free of engine calls so it stays easy to test.
- Match the existing code style: two-space indent, single quotes, no
  semicolons.
- Docs are matter-of-fact: no first person, no em dashes.

## Git

- The default branch is `master`.
- Commits are small and atomic, one logical change each.
- Use conventional commit prefixes (`feat:`, `fix:`, `docs:`, `test:`,
  `refactor:`, `chore:`). One subject line, no body.
- No AI attribution or `Co-authored-by` lines.
