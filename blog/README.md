# Blog authoring

The website reads this directory at build time and renders https://hexagon.autos/blog/. Article content is maintained here, not copied into the website repository.

## Publish an article

1. Add `posts/<slug>.md` using a lowercase, hyphen-separated ASCII slug.
2. Add its metadata to `index.json`: `slug`, `title`, `date` (YYYY-MM-DD), `summary`, `author`, `tags` (array), `language` (`en` or `zh-CN`), and `draft` (boolean).
3. Review with `draft: true`. To preview locally, clone the website repository and run `BLOG_CONTENT_DIR=/absolute/path/to/hexagon-docs npm run dev`. The normal preview excludes drafts; use a temporary local metadata edit to `draft: false` when reviewing the article, then restore it before sharing an unpublished draft. On PowerShell set `$env:BLOG_CONTENT_DIR` before running the command.
4. Set `draft: false` and push to `main` when publication is intended. The GitHub Actions workflow requests a website rebuild. Check that Cloudflare completed it and `/blog/source.json` reports your content commit.

Use the Git commit date only if it is the actual editorial publication date. Future-dated entries are not published early; a later build is needed to publish them. Removing an entry or marking it draft removes its public page on the next successful build.

## Markdown and media

The article title comes from the metadata. Start body sections at `##`. Tables, lists, quotes, links and fenced code are supported. Raw HTML is rendered as text; JavaScript, iframes and arbitrary embeds are not supported.

Put PNG, JPEG, GIF or WebP images in `media/` and reference them with `../media/name.png`. Include alt text. External HTTPS images are supported, but self-contained local images are preferred. Link other published articles with `./slug.md`; draft or missing targets fail the build. No front matter is required: metadata lives only in `index.json`.

`index.json` is explicit: README files and unlisted drafts never become posts. Duplicate slugs, invalid dates or missing published article files fail the build. A content fetch failure must not silently publish an empty blog; the previous successful deployment stays live.

## Deployment setup

The workflow `.github/workflows/publish-blog.yml` uses the repository secret `WEBSITE_DEPLOY_HOOK`, a Cloudflare Workers Builds hook for the existing `haxegon-website` Worker and website branch `main`. Keep the URL secret. The connection and token are held by GitHub/Cloudflare, so authors only need GitHub write access. Website commits also rebuild the blog from this repository's `main` branch.
