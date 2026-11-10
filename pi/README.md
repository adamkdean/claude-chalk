# pi/ — claude-chalk ported to Pi

[claude-chalk](../) teaches Claude Code to write replies in chalk-template markup (`{red text}`) and draws them in colour. This directory ports the same mod to [Pi](https://pi.dev) as a single self-contained TypeScript extension: **zero npm dependencies, no build step**.

## How it works

| claude-chalk (Claude Code) | pi/ (Pi) |
| --- | --- |
| `prompt.compose` hook teaches the model the markup | `before_agent_start` injects the same guide as a system-prompt section (`chalk`) |
| `ui.render` on `AssistantMessage` draws an Ink tree | `registerMarkdownTransformer` rewrites assistant markdown with raw SGR sequences before Pi renders it |

The parser is copied verbatim from `hooks/markup.ts`, so behaviour matches the original mod. The stored transcript keeps the raw markup; only what is drawn changes. Assistant messages are transformed, user echoes and thinking blocks stay literal — same as the Claude Code side.

## Install

Requirements: Pi ≥ 1.4.0 (`@earendil-works/pi-coding-agent`), any recent Node (the extension loads via Pi's jiti regardless of system Node).

1. Copy `chalk.ts` into your user extensions directory:
   - Linux/macOS: `~/.pi/agent/extensions/chalk.ts`
   - Windows: `%USERPROFILE%\.pi\agent\extensions\chalk.ts`
2. Start (or restart) Pi — the extension appears under `[Extensions]`.
3. Verify by asking for a reply containing `{green ✓ done}`; it renders green and the raw terminal bytes contain `\x1b[32m`.

Circuit breaker: run `pi -ne` to skip all extensions, or delete the file. The worst failure mode is "markup shown as written" — never a broken UI. Non-TUI modes (rpc/json/print) are untouched by design.

## Markup syntax

Write `{style text}` in prose; chain styles with dots and nest blocks:

| Markup | Effect |
| --- | --- |
| `{green ✓ All 42 tests pass}` | green text |
| `{red.bold Build failed}` | bold red |
| `{yellow Warning:} the cache is stale` | yellow phrase, rest plain |
| `{bgBlue.whiteBright  Which region? }` | white-on-blue bar (questions) |
| `{#ff8800 exact hex}`, `{rgb(255,136,0) rgb}` | 24-bit truecolour |
| `{#:003366 bg only}`, `{#ffffff:cc0000 fg:bg}` | hex background / both |
| `{x256(196) xterm-256}`, `{bgX256(45) …}` | 256-colour fallback tier |

Colours: `black red green yellow blue magenta cyan white`, each also with a `Bright` suffix; backgrounds prefix `bg` (`bgRed`, `bgBlueBright`). Modifiers: `bold dim italic underline inverse strikethrough`.

Rules the guide enforces: colour only where it helps scanning (red = error, green = success, yellow = warning); never bare white/black text without a background; put blocking questions on their own line over a background bar (`bgBlue` ordinary, `bgRed` risky). Markup is prose-only — inside code spans and blocks it shows as written.

## Tests

```sh
node --test "tests/*.mjs"   # Node ≥ 22.18 (native .ts import)
# older 22.x: node --experimental-strip-types --test "tests/*.mjs"
```

Covers the parser regressions ported from claude-chalk's suite plus SGR emitter output (named → palette, truecolour, modifier stacking, streaming partials). No dependencies — `node:test` only.
