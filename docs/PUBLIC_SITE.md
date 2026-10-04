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

## URL (live since 2026-10-04)

Derived from the repository configuration on 2026-10-04: owner `Kounishiyuuki` is a user account, the repository
`MannerPath` is public, Pages is not yet enabled (`GET /repos/Kounishiyuuki/MannerPath/pages` → 404), and the owner
has no `kounishiyuuki.github.io` user-site repository or custom domain. GitHub therefore serves a project site at:

| Page | Published URL (no custom domain) |
| --- | --- |
| Site origin (`MANNERPATH_PUBLIC_SITE_URL`) | `https://kounishiyuuki.github.io/MannerPath/` |
| Privacy Policy URL | `https://kounishiyuuki.github.io/MannerPath/privacy/` |
| Support URL | `https://kounishiyuuki.github.io/MannerPath/support/` |

Confirmed 2026-10-04: Pages `build_type: workflow`, `html_url` = the origin above, `cname: null`, HTTPS enforced; the
first **Pages** run (`37209926902`, main `d70139c`) succeeded, and all three pages answer `200` over HTTPS without
sign-in (`/privacy` and `/support` without the trailing slash redirect once to the slash form). If a custom domain is
added later, the origin changes; re-derive it from the deployment's `page_url` and update the Release build setting.

## Maintainer setup (one time)

1. Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Merge the change that adds `site/` and `.github/workflows/pages.yml` to `main` (or run the **Pages** workflow
   manually from the Actions tab).
3. Confirm the workflow's `deploy` job shows the page URL, and open both pages over HTTPS from a signed-out browser.
4. Send a test email to mannerpath.support@gmail.com and confirm it is received and monitored.
5. Enter the two page URLs in App Store Connect. (Steps 1–3 were done on 2026-10-04; the Release build setting is
   committed, see below.)

## In-app access

Data & Privacy → **Privacy Policy and Support**: Privacy Policy and Support links (only when
`MANNERPATH_PUBLIC_SITE_URL` is a valid HTTPS origin; `PublicSite.links`), email contact and the operator name
(always). The origin comes only from the build setting, never from Swift code:

| Configuration | `MANNERPATH_PUBLIC_SITE_URL` | Result |
| --- | --- | --- |
| Release (App Store / TestFlight archives) | committed in the MannerPath target's Release build settings: `https://kounishiyuuki.github.io/MannerPath/` | links shown |
| Debug (development, unit and UI tests) | unset | links hidden; email and operator shown |

`scripts/check-iphone-api-base-url.sh` (part of `make apple-validate`) builds both configurations without overrides and
checks `MannerPathPublicSiteURL` in the built Info.plist. A command-line override still wins for either configuration.

Release-build link check on a simulator (needs the internet; not part of the routine UI phases): build
`MannerPathUITests` with `-configuration Release` and run `-only-testing:MannerPathUITests/H_PublicSiteLinksUITests`.
It opens both links in Safari and asserts the published headings and the `kounishiyuuki.github.io` address.

## Keeping the policy true

Update the policy and its "Last updated" date in the same change as any change to location, networking, logging,
reports, App Attest, photos, analytics or third-party SDKs. Reports, App Attest registration and photo upload are
described as unavailable in the initial read-only v1; enabling any of them requires updating the policy first.
