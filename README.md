# GenLaTeX

An open-source LaTeX editor with optional AI assistance. One repository, one
root `.git`, and one static website/editor build. Original project source is
MIT licensed; third-party components keep their own licences.

## Run locally

Requires Node.js 22 and npm.

```powershell
npm ci
npm run dev
```

Open http://localhost:3000/editor/. You can create projects and multiple text
files, import `.tex`/`.bib`/`.sty`/`.cls` files, choose a main file, download
individual files, and export or restore a `projects.genlatex.json` backup.
Projects are saved in local storage on this device, for this site's origin.
Clearing site data removes them. There is no cloud account or synchronisation
in the static editor. Image/binary project imports are not yet supported.

## AI assistance

Open AI settings in the editor and enter a full OpenAI-compatible
chat-completions endpoint, a model ID, and your own key. The provider must
allow browser requests through CORS. Local compatible servers may be used on
`http://localhost` or `http://127.0.0.1` when configured to allow the site origin.
Some browsers may require permission to access local network services.

The key stays in tab memory and is cleared on reload. Clicking Ask AI sends
your prompt and the current file to the selected provider. Provider fees apply.
AI changes are suggestions: inspect the response and click Apply to use them.
Suggestions are rejected if the source has changed since the request; Undo AI
change restores the previous version. No host-wide API key is embedded in the
static build.

## Browser PDF compilation

PDF compilation uses the optional SwiftLaTeX pdfTeX WebAssembly engine in a Web
Worker. This checkout does **not** include the engine binaries. With Python 3
and network access, install the pinned upstream release before building:

```powershell
npm run setup:pdf
npm run build
```

The installer writes the worker, WebAssembly binary, licence, and source record
to `public/vendor/swiftlatex/`. Commit those assets if you want Netlify to use
them on future builds, or run the installer in your build environment. Missing
assets produce an explicit message in the compilation log. Package downloads
may still require internet access. This integration currently makes one pdfTeX
pass; it does not run BibTeX/Biber, XeLaTeX, LuaLaTeX, or external commands.
Complex projects may require the original server workspace or a local TeX
installation. The worker protocol is covered by mocked tests; real browser
compilation was not verified in the restricted build environment.

SwiftLaTeX is separately AGPL-3.0 licensed. Its upstream source and licence are
recorded with downloaded assets; see [third-party notices](THIRD_PARTY_NOTICES.md).

## Deploy the static site to Netlify

1. Push this root folder to your Git repository and import that repository in
   Netlify. The root `netlify.toml` supplies the settings below.
2. Set `NEXT_PUBLIC_SITE_URL` to the actual public site URL. Optionally set
   `NEXT_PUBLIC_SOURCE_URL` to your actual public source repository.
3. If Netlify enables its Next.js server adapter, set
   `NETLIFY_NEXT_PLUGIN_SKIP=true` in the Netlify UI too. No Next.js runtime is
   needed for this export.

| Setting | Value |
| --- | --- |
| Base directory | Repository root (leave blank) |
| Build command | `npm run build` |
| Publish directory | `out` |
| Node version | `22` |

`output: 'export'` makes `next build` generate `out/`; do not run `next export`.
For a manual deployment, run `npm ci`, optionally `npm run setup:pdf`, then
`npm run build`, and upload **only `out/`** at https://app.netlify.com/drop.
Preview that exact static output locally with `npm start`.

The static site hosts the homepage, blog, tools, and `/editor/` together.
Built-in table formatting, LaTeX formatting, PDF text extraction, and metadata
tools retain their client-side implementations. AI generator tools and Word
conversion require the optional server workspace; absent configuration gives
an explicit error rather than calling a missing local API. Configure
`NEXT_PUBLIC_SERVER_URL` only when that service is running and its CORS policy
allows your static site. PDF text extraction is not OCR or faithful equation
reconstruction.

## Repository layout

| Path | Purpose |
| --- | --- |
| `app/`, `components/`, `lib/`, `public/` | Unified static website and editor |
| `services/workspace/` | Preserved full server editor and its APIs |
| `services/agent/` | Preserved Python research and writing agent |
| `scripts/` | Static preview and optional PDF engine installation |
| `tests/` | Project validation, AI transport, and worker contract checks |

The original server components remain available under this single repository.
They are not deployed by the static Netlify build. Their databases, cloud
accounts, billing, sharing, Zotero integration, and research-agent workflows
are not features of the new browser-only editor. See [services](services/README.md).
No production `.env` files or previous `.git` histories were copied.

## Checks and current validation

```powershell
npm run typecheck
npm test
npm run build
```

Five core tests passed, and the editor library passed standalone TypeScript
checking. Full dependency installation and the production build could not run
in this session: network access was unavailable and the npm cache lacked the
required `xlsx` tarball. Run the commands above with network access before
deployment. AI calls were tested with mocks, not a paid provider. The GitHub
workflow runs the full checks on push.

Official references:
* https://nextjs.org/docs/app/guides/static-exports
* https://docs.netlify.com/build/frameworks/overview/
* https://github.com/SwiftLaTeX/SwiftLaTeX
