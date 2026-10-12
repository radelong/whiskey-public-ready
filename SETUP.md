# Whiskey Cellar setup

This source-only example contains a React inventory/tasting interface, a Cloudflare Worker/D1 API, and a Node/SQLite container variant. It contains no original collection, accounts, tasting records, uploaded images, deployment identifiers, credentials or original Git history.

Install pinned dependencies with npm ci. Run npm run db:local to apply migrations to a new local database, then npm run dev. The first local visitor creates an administrator account. Keep initial setup private until you create that account. Public-source tests use synthetic users and passwords.

For your own Cloudflare deployment, create a new D1 database and replace the all-zero database_id. Select your own worker name, routes and access policy. workers_dev is disabled and routes are empty by default. npm run db:remote and npm run deploy are manual operations against your configured account; they are not part of the source review. No production deployment workflow is included.

Email login is optional and requires both your chosen ADMIN_EMAIL and a separately supplied RESEND_API_KEY. There is no default email recipient. Optional ACCESS_TEAM and ACCESS_AUD must refer to your own Access application with an administrator-only policy; every identity accepted by that policy is trusted as an administrator. Preserve HTTPS and origin restrictions. Never commit runtime secrets.

The Share page derives the guest /guest URL from the current deployment rather than an original domain. Distillery pictures use one self-authored generic illustration. CSV examples are fictional. Optional product/flavor lookups query public third-party services when explicitly requested; availability, terms and response accuracy are outside the offline source review.

Run npm test and npm run check for regression and type validation; npm run build builds the Worker/client. See docker/README.md for the Node/SQLite variant. Production app/database backups are outside the source-only package. No new license is assigned to first-party code; dependencies retain their own licenses.
