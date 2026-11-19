# Contributing to GenLaTeX

Use Node.js 22. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`
before submitting changes. Keep the root app compatible with static export:
no runtime Next.js API routes, server actions, cookies, or filesystem access.

Optional server functionality belongs in services/. Never commit real
credentials, uploaded documents, or generated research projects. Report the
affected component and reproduction steps when opening an issue. Contributions
to the original project code are under the MIT licence; third-party code keeps
its own licence.
