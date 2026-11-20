# Documentation publishing SOP

## Deployment source

- Repository: https://github.com/NexusFox88/hexagon-docs
- Branch: `main`
- Mintlify project: `sponson/hexagon`
- Configuration: `/docs.json` at repository root
- Live documentation: https://docs.hexagon.autos
- Deployment dashboard: https://app.mintlify.com/sponson/hexagon/publishes/overview

Pushes to the connected branch trigger Mintlify deployment. DNS does not need to change for content updates. The former `NexusFox88/docs` repository is not the active publishing source after migration.

## Edit and validate

1. In this checkout, run `git status --short` and review existing work. With a clean tree, run `git pull --ff-only origin main`.
2. Edit documentation in `en/` and `zh-CN/`, navigation in `docs.json`, and appearance in `style.css`. Preserve both languages, monochrome controls and square navigation states.
3. Run:

```bash
npx --yes mint@4.3.74 validate
npx --yes mint@4.3.74 broken-links
git diff --check
git diff --stat
```

The CLI version is pinned to the version used during migration. Upgrade it deliberately after checking validation compatibility.

For visual changes, run `npx --yes mint@4.3.74 dev --no-open` and review the affected pages in light and dark modes.

## Publish and verify

Review the complete diff and stage only intended files. When every local change belongs to the release:

```bash
git add -A
git diff --cached --stat
git diff --cached --check
git commit -m "Update Hexagon documentation"
git push origin main
```

In the deployment dashboard, match the new commit and wait for `Successful`. Then check the changed routes on the live domain. A successful push is not a successful deployment. If a cached page remains, reload or use a temporary version query parameter and confirm the actual content.

Rollback with `git revert <commit>` and push the resulting commit to `main`; verify the replacement deployment.

## Optional product-source import

Routine edits can be made directly in this repository. The historical import tool remains available for an intentional refresh from product Markdown:

```bash
python3 tooling/import-product-docs.py /absolute/path/to/Hexagon
```

This reads the product checkout's current local files, including uncommitted edits. It rewrites generated MDX, `docs.json`, brand logos, `.mintignore` and `migration-manifest.json`; it can overwrite direct documentation edits. Compare and reconcile before publishing. It does not remove stale pages/resources when the source deletes or renames them; remove those explicitly and add redirects when needed. It preserves `style.css` and `fonts/`. Any persistent configuration change must also be reflected in the import tool before using it again.

Review imported `resources/` for public suitability. Those files are excluded from Mintlify rendering but remain available on GitHub.

## Blog ownership

Do not move or overwrite `blog/`. It remains excluded from Mintlify rendering. Blog changes follow `blog/README.md` and the existing website workflow; documentation-only changes do not match that workflow's blog path filter.
