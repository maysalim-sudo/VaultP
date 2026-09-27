# VaultP website

The landing page and privacy policy. Plain static files — no framework, no build
step, no JavaScript, and no request to any domain but its own.

| File | |
|---|---|
| `index.html` | Landing page |
| `privacy.html` | Privacy policy (served at `/privacy`) — the URL to give Google Play |
| `styles.css` | Everything visual, from the app's own design tokens |
| `vercel.json` | Security headers: a CSP that allows only this site's own files, HSTS, no framing, no referrer, no device permissions |
| `serve.mjs` | Local preview with the same headers, so the CSP is tested before deploy (not deployed) |

## Preview

```bash
node apps/web/serve.mjs
```

Then open <http://localhost:4173>. The browser console should stay empty — a CSP
violation shows up there first.

## Deploy on Vercel

1. **Add New → Project**, import the GitHub repository.
2. **Root Directory:** `apps/web`
3. **Framework Preset:** Other. Leave the build and install commands empty; the
   output directory is the root directory itself.
4. Deploy. `vercel.json` in this folder applies the headers and clean URLs.

After it is live, check the headers at <https://securityheaders.com> and the
policy at <https://csp-evaluator.withgoogle.com>.

## Rules for editing

- **No third-party requests.** No web fonts from a CDN, no analytics, no embeds.
  The page makes the same promise the app does.
- **No inline styles or scripts.** The CSP blocks them; put styles in `styles.css`.
- **Claims must match `SECURITY.md`.** The security section quotes it; if one
  changes, change the other.
