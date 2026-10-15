# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

Nested rules also live in `tests/AGENTS.md`, `tests/e2e/AGENTS.md` and `src/main/daemon/AGENTS.md`. Read them before touching those areas.

# Commands

Toolchain: Node 24, pnpm, and the Bun version in `config/.bun-version` (Vitest runs on Bun).

- `pnpm install` then `pnpm dev` — run the app in dev; `pnpm dev:web` serves the browser client.
- Single test file: `pnpm test src/path/x.test.ts`; single test: add `-t "test name"`.
- Faster repeat runs (skips `build:packages` and the native-runtime check): `node config/scripts/run-vitest.mjs run --config config/vitest.config.ts <file> -t "<name>"`.
- `pnpm test:node` runs the suites fully on Node. Files that need real Node (SQLite, native modules, CLI, persistence) are listed in `config/scripts/vitest-node-runtime-files.mjs`.
- Unit tests sit next to the code as `*.test.ts(x)`. The environment defaults to node; renderer tests opt in with `// @vitest-environment happy-dom`.
- E2E: `pnpm test:e2e` (Playwright, `tests/playwright.config.ts`); `SKIP_BUILD=1` reuses the last e2e build.
- CI parity before a PR: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- After editing `src/packages/process-host`, run `pnpm build:packages`.
- Generated files checked by `pnpm lint`:
  - after RPC changes, run `pnpm generate:rpc-params-catalog`;
  - after localization changes, run `pnpm sync:localization-catalog`;
  - the other generators are the `generate:*` scripts.

## Ratchets

`pnpm lint` enforces `config/*-baseline.txt` lists. They may only shrink, and you must never add an entry to make CI pass:

- **max-lines**: 300 lines for `.ts`, 400 for `.tsx`. Split the file instead.
- **`@ts-nocheck`**: no new uses.
- **`child_process` imports**: no new direct imports.
- **Synchronous spawns in main**: no new ones.
- **Reads of `activeRuntimeEnvironmentId`**: no new reads.
- **Layout writers**: no new ones in main or renderer; the runtime owns layout.

# Architecture

Orca is an Electron app that runs CLI coding agents in parallel worktrees. It also exposes the same core headlessly to SSH hosts, WSL, a CLI, a web client and a mobile app.

- **Runtime core**: `OrcaRuntimeService` (`src/main/runtime/orca-runtime.ts`, built as a chain of mixins) owns worktrees, terminals, agents, the browser and orchestration.
  - In the desktop app it runs inside Electron main. `src/main/index.ts` is a thin bootstrap into `src/main/startup/*`.
  - **orcad** (`src/main/orcad/`) is the same runtime under plain Node with no Electron. It is what runs on SSH remotes, in WSL and under `orca serve`.
  - The deploy and tunnel code for orcad is in `src/main/ssh/orcad-*`. `src/main/ssh/legacy-relay-bridge/` is a compatibility shim only.
- **Terminal daemon** (`src/main/daemon/daemon-entry.ts`): a separate process that owns the PTYs, so terminals survive app restarts and updates.
  - Main reaches it through `DaemonClient` over token-authenticated control and stream sockets.
- **Renderer → main**:
  - The React app lives in `src/renderer/src`.
  - It calls `window.api.<domain>.<fn>`, which `src/preload/index.ts` assembles from `src/preload/api/*`.
  - These calls reach `ipcMain.handle` handlers in `src/main/ipc/*`, which are registered via `src/main/startup/main-process-ipc-bootstrap.ts`.
- **Renderer state**: one Zustand store, `useAppStore` (`src/renderer/src/store/index.ts`), composed from the slices in `store/slices/`.
- **Runtime RPC** (used by the CLI, paired clients and remote hosts):
  - Methods are defined with `defineMethod` / `defineStreamingMethod` (`src/main/runtime/rpc/core.ts`) in `src/main/runtime/rpc/methods/*`, and registered in `methods/index.ts`.
  - Params schemas are zod and live in `src/shared/rpc-contract/`.
  - Transports are a Unix socket / named pipe for the local CLI, a WebSocket for paired clients and mobile on the LAN, and the end-to-end-encrypted cloud relay.
  - Terminal bytes travel as binary frames (`src/shared/terminal-stream-protocol.ts`).
  - The wire-compatibility rules in AGENTS.md apply here.
- **CLI** (`src/cli/index.ts`): finds the running runtime via `orca-runtime.json` in userData, then sends newline-delimited JSON RPC to it.
- **Web client**: builds the same renderer from `web-index.html` (`vite.web.config.ts`). `src/renderer/src/web/web-preload-api.ts` implements `window.api` over an encrypted WebSocket.
- **Agent integration**:
  - The agent catalog is `src/shared/tui-agent.ts` and `tui-agent-config.ts`.
  - Per-agent dirs (`src/main/claude`, `codex`, `gemini`, `opencode`, …) mainly install managed hooks into that agent's config, locally or over SSH.
  - The hooks POST to `AgentHookServer` (`src/main/agent-hooks/`), which is the single agent-status store. The renderer mirrors it in `store/slices/agent-status*`.
  - Structured-chat sessions are in `src/main/native-chat`, `src/main/acp` and `src/main/claude/claude-structured-*`.
- **Persistence**: SQLite (`node:sqlite`) in `profile-state.db` under userData, in `src/main/persistence/profile-state/`. The legacy `orca-data.json` is used only for import and recovery.
- **Localization**:
  - Renderer copy goes through `translate('key', 'English fallback')` or `useTranslation`; main-process copy uses `translateMain()`.
  - Catalogs are in `src/renderer/src/i18n/locales/`, and the `verify:localization-*` lint gates check them.
- **Other trees**:
  - `src/wsl-guest`: Node helpers that run inside WSL distros.
  - `src/packages/process-host`: `@orca/process-host`, the only allowed subprocess layer.
  - `native/`: platform helpers built by `pnpm build:native`.
  - `mobile/`: an Expo/React Native companion app, a separate pnpm workspace.
  - `cloud/`: the relay and push servers, also a separate pnpm workspace.
