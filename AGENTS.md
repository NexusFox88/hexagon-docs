# Hexagon documentation and blog

This repository is `NexusFox88/hexagon-docs`. Blog content belongs only in `blog/`; presentation and rendering belong in `NexusFox88/Haxegon-Website`. Do not copy website code into the product repository.

Read `blog/README.md` before editing articles. Never publish placeholder articles: templates remain `draft: true`. Do not invent release dates, customer claims, benchmarks or compatibility guarantees. Keep credentials and deployment hook URLs out of Git and logs.

Pushing blog content to `main` triggers the website rebuild through the Cloudflare deploy hook configured as the GitHub Actions secret `WEBSITE_DEPLOY_HOOK`. Check the Actions result, then the Cloudflare build result and the live `/blog/source.json` content revision. A successful hook request only means the build was accepted, not that publication finished. The website's `AGENTS.md` defines full release verification.

Product source links must use the canonical repository URL `https://github.com/NexusFox88/Hexagon` (including security and license paths). The website and content repository names are separate and must not be renamed by this rule.

Write Blog titles, summaries, article bodies and cover text in English. Optional article covers belong in `blog/media/`, referenced by `cover.src` with meaningful `cover.alt` in `blog/index.json`; follow the schema in `blog/README.md`. Keep requested previews as drafts until publication is explicitly authorized.

Public documentation links in Blog articles must use `https://docs.hexagon.autos/en` and verified routes beneath it. The product GitHub link is `https://github.com/NexusFox88/Hexagon`.
