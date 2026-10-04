# Public Privacy Policy and Support site

The App Store needs a public HTTPS Privacy Policy URL and Support URL. They are static pages in `site/`,
published by GitHub Pages through `.github/workflows/pages.yml`. Only `site/` is published; `docs/` is not.

| Page | Source | Content owner |
| --- | --- | --- |
| Landing | `site/index.html` | links to both pages |
| Privacy Policy | `site/privacy/index.html` | must match `docs/APP_PRIVACY_INVENTORY.md` and the App Store privacy answers |
| Support | `site/support/index.html` | permissions, coverage, offline, Watch, corrections/removal, contact |

Confirmed maintainer inputs (2026-10-04): operator **MannerPath 運営**, contact **mannerpath.support@gmail.com**,
publication by GitHub Pages.

## URL (derived, not yet live)

Derived from the repository configuration on 2026-10-04: owner `Kounishiyuuki` is a user account, the repository
`MannerPath` is public, Pages is not yet enabled (`GET /repos/Kounishiyuuki/MannerPath/pages` → 404), and the owner
has no `kounishiyuuki.github.io` user-site repository or custom domain. GitHub therefore serves a project site at:

| Page | URL once Pages is enabled without a custom domain |
| --- | --- |
| Site origin (`MANNERPATH_PUBLIC_SITE_URL`) | `https://kounishiyuuki.github.io/MannerPath/` |
| Privacy Policy URL | `https://kounishiyuuki.github.io/MannerPath/privacy/` |
| Support URL | `https://kounishiyuuki.github.io/MannerPath/support/` |

These are candidates until the first deployment succeeds. If a custom domain or a user site with a custom domain is
added later, the origin changes; re-derive it from the deployment's `page_url` rather than reusing this table.

## Maintainer setup (one time)

1. Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Merge the change that adds `site/` and `.github/workflows/pages.yml` to `main` (or run the **Pages** workflow
   manually from the Actions tab).
3. Confirm the workflow's `deploy` job shows the page URL, and open both pages over HTTPS from a signed-out browser.
4. Send a test email to mannerpath.support@gmail.com and confirm it is received and monitored.
5. Set `MANNERPATH_PUBLIC_SITE_URL` for the release build to the confirmed origin (same mechanism as
   `MANNERPATH_API_BASE_URL`, `docs/RELEASE_CHECKLIST.md`), and enter the two page URLs in App Store Connect.

## In-app access

Data & Privacy → **Privacy Policy and Support**: Privacy Policy and Support links (only when
`MANNERPATH_PUBLIC_SITE_URL` is a valid HTTPS origin; `PublicSite.links`), email contact and the operator name
(always). No unpublished URL is compiled into the app: the build setting is empty by default.

## Keeping the policy true

Update the policy and its "Last updated" date in the same change as any change to location, networking, logging,
reports, App Attest, photos, analytics or third-party SDKs. Reports, App Attest registration and photo upload are
described as unavailable in the initial read-only v1; enabling any of them requires updating the policy first.
