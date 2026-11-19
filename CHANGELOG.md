# Changelog

## 0.1.1

- Fix: all install instructions now include the required --profile web flag.

## 0.1.0 (2026-11-19)

- Initial release.
- `/free-models` command: lists configured models as `FREE` / `UNKNOWN` and recommends a safe default (`hy4-flash-free` preferred).
- Shipped catalog contains only `opencode-go/hy4-flash-free` and `opencode-go/longcat-2.5-free`; no paid models.
- A model counts as free only when explicitly marked `free: true`, or when its id ends with `-free` and its provider is absent or `opencode-go`.
- Reads the bundle config from the second `apply(ctx, config)` argument; `ctx.config` is ignored (regression test included).
- Registers the command through `ctx.effect()` so disable/reload disposes it cleanly.
- `--json` output with only known fields; all emitted strings are redacted.
- Fully offline test suite with synthetic fixtures; read-only runtime — no network calls, file writes, config mutation, or model calls.

## 0.1.2 (2026-11-19)

- Build automatically before npm pack/publish so a clean tag produces a complete runtime.
- Include the demo documentation asset referenced by the README.
