# Deployment

## Edge functions

The repo is the source of truth for what gets deployed. Two paths exist; the first is the standard one, the second is a fallback:

### 1. Standard path — `supabase functions deploy` via CLI

```bash
export SUPABASE_ACCESS_TOKEN=<token from https://supabase.com/dashboard/account/tokens>
./scripts/deploy-edge-functions.sh                                # deploy both
./scripts/deploy-edge-functions.sh evaluate-schedule-submissions  # one at a time
```

This invokes the Supabase CLI which:
- bundles the entrypoint with its `_shared/*.ts` dependencies natively,
- preserves relative imports without manual rewriting,
- ships byte-identical source from main.

This is what CI should run on push to main. A reference workflow file lives at `workflows/deploy-edge-functions.yml.example` (rename + commit when ready to wire into GitHub Actions).

### 2. Fallback path — pre-bundled artifacts

When the CLI isn't usable (e.g. emergency deploys via the Supabase MCP server, which expects content embedded in a single tool call), use the pre-built bundles in `supabase/functions/_bundles/`. They are produced deterministically from the canonical sources by:

```bash
./scripts/bundle-edge-function.sh supabase/functions/<name>/index.ts
# → writes supabase/functions/_bundles/<name>.bundle.ts
```

**The bundle artifacts are committed to the repo and must be regenerated whenever the source changes.** A pre-commit or CI check can enforce this by re-running the bundle script and diffing.

The bundling logic:
- inlines `_shared` modules in dependency order,
- strips relative `import`/`export ... from './...'` statements (everything ends up at module scope after concatenation),
- preserves all behavioural code paths (no comment/JSDoc removal, no synthetic-row pruning),
- keeps external `https://` imports intact.

The output is a single self-contained TS file deployable as the `index.ts` of an edge function.

### Reproducibility check

To verify the bundle artifacts match the canonical sources:

```bash
./scripts/bundle-edge-function.sh supabase/functions/evaluate-schedule-submissions/index.ts
./scripts/bundle-edge-function.sh supabase/functions/emit-shift-recommendations/index.ts
git diff --exit-code supabase/functions/_bundles/
```

A non-zero exit means someone changed source without regenerating bundles. Re-run the bundle commands and commit.

## Migrations

Migrations in `supabase/migrations/` are applied either:

- via `supabase db push` (preferred), or
- via the Supabase Studio SQL editor (paste + run, then record version manually in `supabase_migrations.schema_migrations`).

The migration audit log can be inspected by selecting from `supabase_migrations.schema_migrations` directly.
