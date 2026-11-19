# Optional GenLaTeX services

The static site is built from the repository root. Nothing here is deployed to
Netlify by the static build.

* `workspace/` preserves the original full Next.js editor, APIs, authentication,
  database, storage, billing, collaboration, and native LaTeX compilation code.
* `agent/` preserves the Python research and writing agent, templates, and tests.

Both are source components of this repository, with no nested Git repositories.
Their existing deployment documents describe the original server architecture;
do not use their VPS scripts to deploy the static site. Rebranding changed the
`GENLATEX_*` environment variable prefix to `GENLATEX_*`; use fresh environment
files rather than copying old deployment secrets into the public repository.

The static editor is a new local workspace. Accounts, existing cloud projects,
billing, Zotero integration, and agent workflows have not been migrated into
browser storage. Those features remain available in the original server source.

For the server workspace, install its own dependencies with
`npm --prefix services/workspace ci` and run `npm run dev:server` from the root.
Its default port is also 3000; choose another port when running both frontends.
The Python agent still requires its own dependencies and services. The original
server components were preserved, not end-to-end deployment-tested here.
