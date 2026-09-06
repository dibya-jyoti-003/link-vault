# LinkVault — Changes in this pass

Scope: **backend correctness/security core** (per your instruction). Storage
swap to Cloudflare R2 and cookie-based auth were explicitly deferred — see
"Deferred" section at the bottom.

## 1. Atomic access control (Phase 6 + 7 from the blueprint)

`server/src/routes/shares.js` — `atomicRecordAccess()`

Previously views/downloads were checked, then incremented as two separate
DB operations — a classic TOCTOU race where concurrent requests could both
pass the check before either increment landed. One-time links had the same
problem: nothing stopped two simultaneous requests from both "winning."

Now a single `findOneAndUpdate` does the check and increment atomically:

```js
filter = { _id, expiresAt: { $gt: now } }
if (oneTime) filter.consumed = false
if (maxViews != null) filter[counterField] = { $lt: maxViews }

update = { $inc: { [counterField]: 1 } }
if (oneTime) update.$set = { consumed: true }
```

If the update returns `null`, the request lost the race (or the limit was
already reached / link already consumed) and gets a clean `410
ACCESS_LIMIT_REACHED`. Added a `consumed` boolean to the `Share` model to
back this.

I verified this logic by running 5 concurrent simulated downloads against
`maxDownloads = 3` — only 3 succeed, as your doc's testing checklist asks for
(logic-level verification; couldn't run it against live Mongo in this
sandbox — see note at the end).

## 2. Password handling

- Split `PASSWORD_REQUIRED` (no password sent) from `INVALID_PASSWORD` (wrong
  password sent) as distinct error codes, so the frontend can show the right
  UI state instead of guessing from a single 403.
- Added a dedicated lockout: 5 wrong attempts for a given share+IP within 15
  minutes locks that combination out for 15 minutes (`RATE_LIMITED`),
  independent of the general request-rate limiter. In-memory, no Redis.

## 3. File validation & sanitization (Phase 9)

- `server/src/utils/sanitize.js`: `sanitizeFilename()` strips path
  components, control characters, and header-unsafe characters from
  uploaded filenames before they're stored as metadata. The original name
  is *never* used to build a server-side path — a random object key always
  is (unchanged from before, now enforced more explicitly).
- Added an extension blocklist (`.exe`, `.bat`, `.sh`, `.js`, `.msi`, `.scr`,
  `.dll`, etc. — configurable via `BLOCKED_EXTENSIONS`) that's enforced
  regardless of the declared MIME type, since `file.mimetype` is fully
  client-controlled and easy to spoof.
- `Content-Disposition` header is now built safely (`contentDispositionFilename`)
  to avoid header injection via crafted filenames.

## 4. Consistent API errors (Phase 14)

Every error response is now `{ error: { code, message } }` with the codes
from your doc (`SHARE_EXPIRED`, `ACCESS_LIMIT_REACHED`, `INVALID_PASSWORD`,
`PASSWORD_REQUIRED`, `FILE_TOO_LARGE`, `TEXT_TOO_LARGE`, `RATE_LIMITED`,
`UNAUTHORIZED`, `INVALID_REQUEST`, `SHARE_NOT_FOUND`, `INTERNAL_ERROR`, ...).
`server/src/utils/apiError.js` centralizes this; `server/src/index.js`'s
error handler also maps Multer's file-size errors into the same shape.

Frontend (`client/src/lib/api.js`) got `getErrorCode()` / `getErrorMessage()`
helpers so every page reads the new shape consistently — including a fix for
blob-typed error bodies on file download failures, which the old code didn't
parse at all.

## 5. Rate limiting (Phase 15)

`server/src/middleware/rateLimit.js` — simple in-memory fixed-window
limiter (no Redis, as your doc specified is fine at this scale):
- Auth endpoints (`/auth/login`, `/auth/register`): 20 req / 15 min / IP
- Public share endpoints (`/shares/:id`, `/shares/:id/download`): 60 req / min / IP
- Password verification: separate 5-attempts/15-min lockout per share+IP (above)

## 6. Indexes (Phase 17)

Added a compound `{ owner: 1, createdAt: -1 }` index on `Share` to match the
dashboard's actual query pattern (existing single-field indexes on
`shortId`, `owner`, `expiresAt` were already present and are kept).

## 7. Cleanup / delete route

Tidied the manage-token/owner-auth check on `DELETE /shares/:id` — it
previously faked a request/response pair to reuse the `requireAuth`
middleware, which worked but was fragile. It now verifies the JWT directly.

## What I could verify in this sandbox

- Every changed/new file passes `node --check` (syntax).
- The server boots cleanly through Express/route/middleware registration
  and only fails at the MongoDB Atlas connection step — expected, since
  this sandbox's network egress doesn't include `mongodb.net`, and no local
  `mongod` is installable here either.
- Unit-tested the pure logic in isolation: filename sanitization, extension
  blocking, error factories, and the password-lockout state machine — all
  behave as designed.
- The client builds cleanly with the updated error handling.
- **Not verified**: a live end-to-end run against a real database (the
  concurrency test, real password/lockout flow through HTTP, real file
  upload → download round trip). I'd recommend running the scenarios in
  Phase 20 of your original doc once you deploy this somewhere with DB
  access — happy to write an actual test suite (Jest/Supertest) for this if
  useful.

## Deferred (per your last answer)

~~Cloudflare R2 storage~~ — **now implemented**, see Pass 2 below.
~~httpOnly cookie auth~~ — **now implemented**, see Pass 2 below.
~~Share access tokens~~ (Phase 5) — still not implemented; low priority now
that cookie auth covers the main motivation (not re-sending secrets on
every request). The share password is still sent per-request via
`x-share-password`, protected by the rate-limit lockout above.

---

# Pass 2 — Cloudflare R2 + httpOnly cookie auth

You asked me to write the code for both, even though I can't test against
live credentials here. Everything below is implemented and unit-tested at
the logic level (see "What I verified" at the end); you'll need to smoke
test it against real R2/Mongo once you have credentials.

## R2 storage (Phase 1-4)

`server/src/services/storage.js` — rewritten around a provider switch
(`STORAGE_PROVIDER=local` or `r2`, in `.env`):

- **`uploadFile({buffer, mimeType, originalName})`** → `{ objectKey }`.
  For R2, uses `@aws-sdk/client-s3`'s `PutObjectCommand` with a randomly
  generated key (`shares/<random>/<random>.<ext>`, no user-controlled path
  components). For local, writes to `STORAGE_DIR` with the same key scheme.
- **`deleteFile(objectKey)`** → `DeleteObjectCommand` (R2) or `fs.unlink`
  (local).
- **`getSignedDownloadUrl(objectKey, {filename, mimeType})`** → the core
  of Phase 3/4. For R2 this calls `@aws-sdk/s3-request-presigner` to mint
  a presigned `GetObjectCommand` URL (5 min TTL by default, configurable
  via `R2_SIGNED_URL_TTL_SECONDS`), with `ResponseContentDisposition` /
  `ResponseContentType` overrides so the browser downloads with the right
  filename even though R2 only knows the random object key.

  **The R2 bucket should be created as private** (no public access) — the
  signed URL is the only way in, exactly like your blueprint's Phase 3.
  I set `forcePathStyle: true` on the S3 client, which is the
  universally-documented-safe addressing mode for R2 (virtual-hosted-style
  subdomains work too on newer R2 accounts, but path-style always works).

- The Share model's file field was renamed `objectPath` → `objectKey` to
  match your blueprint's terminology (Phase 2) — this only matters for
  fresh data, there's nothing to migrate since you haven't deployed yet.

### Local dev gets the same contract, not a different code path

Rather than branching the routes on provider, the **local** provider also
implements `getSignedDownloadUrl()` — it mints a short-lived (60s
default), single-use JWT and returns
`{BASE_URL}/api/v1/shares/_raw/<token>`. A new route,
`GET /shares/_raw/:token`, verifies + consumes that token (in-memory
single-use set) and streams the file off local disk. So whether you're
running locally or against R2, the client always gets back
`{ downloadUrl, expiresIn }` from `/shares/:id/download` and just
navigates the browser there — `ViewShare.jsx`'s download handler no
longer needs to know which provider is active.

### The one-time-link deletion timing problem (explicitly flagged in your doc)

Your blueprint calls out: *"we need to be careful not to delete the R2
object before the download has started."* Since the download endpoint now
returns a signed URL instead of streaming the bytes itself, the response
finishes almost immediately — well before the browser has necessarily
followed the link. So for one-time file shares, physical cleanup
(`purgeShare`, which deletes both the object and the Mongo document) is
scheduled via `setTimeout` for `signedUrlTTL + 30s` after the URL was
issued, not on `res.on('finish')`. This is safe because the *access*
guarantee (only one download ever succeeds) is already enforced
atomically via the `consumed` flag at the moment the URL is issued — the
delayed purge is pure garbage collection, not a security boundary.

## httpOnly cookie auth (Phase 11)

- `server/src/utils/cookies.js` — `setAuthCookie()` / `clearAuthCookie()`.
  Cookie is `httpOnly`, and `secure`/`sameSite` are driven by
  `COOKIE_SECURE` / `COOKIE_SAMESITE` env vars (defaults: `false` /
  `lax`, correct for local dev where client+server are both "localhost").
  **For a real deployment where frontend and backend are on different
  domains** (e.g. Vercel + Render), cross-site cookies need
  `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` (requires HTTPS, which
  both platforms give you for free) — documented inline in
  `.env.example`.
- `server/src/routes/auth.js` — `/login` and `/register` now call
  `setAuthCookie()` and no longer return the raw JWT in the response
  body at all, so there's nothing for a well-behaved frontend to
  accidentally stash in `localStorage`. Added `POST /auth/logout`
  which clears the cookie server-side.
- `server/src/middleware/auth.js` — `requireAuth` now reads the token from
  the cookie first, falling back to `Authorization: Bearer <token>` for
  non-browser API clients (scripts/Postman) that can't hold a cookie jar.
- `server/src/index.js` — CORS now sets `credentials: true` and **requires
  `CLIENT_ORIGIN` to be explicitly set** (browsers refuse credentialed
  requests against a wildcard origin, so I removed the old "allow
  everything if unset" fallback and log a warning instead). This is
  already set correctly in `.env.example`.

### Frontend

- `client/src/lib/api.js` — axios client now sends `withCredentials: true`
  and no longer reads/attaches any token from `localStorage`. Since the
  real credential is httpOnly (invisible to JS by design), the frontend
  needs *some* non-sensitive signal to know "should I show the logged-in
  UI" without waiting on a round trip — that's `setAuthedHint()` /
  `isAuthedHint()` / `clearAuthedHint()`, which just track a boolean flag
  (`lv_authed`) and the user's email for display. This is purely a UI
  hint; the server independently re-validates the real cookie on every
  request regardless of what this flag says.
- `App.jsx`, `Upload.jsx`, `MyShares.jsx`, `Login.jsx`, `Register.jsx` —
  updated to use the hint helpers instead of reading `lv_token`; logout
  now calls `POST /auth/logout` before clearing the local hint.
- `ViewShare.jsx`'s download button now does
  `window.location.href = data.downloadUrl` against the signed URL
  instead of streaming a blob through axios.

## What I verified in this pass

- All new/changed server files pass `node --check`.
- Server boots cleanly through the entire module graph (Express, cookie-
  parser, CORS, all routes, both storage providers) — only fails at the
  actual MongoDB Atlas connection, same limitation as Pass 1 (no network
  path to `mongodb.net` or a local `mongod` in this sandbox).
- **Local storage provider, isolated**: uploaded a real file, minted a
  signed URL, verified the token resolves and streams the correct bytes
  exactly once, confirmed a second use of the same token is rejected,
  confirmed an expired token is rejected (`TokenExpiredError`), confirmed
  `deleteFile` actually removes the file from disk.
- **R2 provider, isolated (no real network call needed)**: confirmed it
  fails with a clear, actionable error when credentials are missing;
  confirmed the presigned URL is constructed correctly against fake
  credentials — this exercises the real AWS SigV4 signing path locally
  (pure crypto, no network access required) and confirms path-style
  addressing, the TTL, and the `Content-Disposition`/`Content-Type`
  overrides all land in the URL correctly.
- Client builds cleanly (`vite build`) with the cookie-auth changes.
- Grepped the whole repo for stale references (`lv_token`, `objectPath`,
  `uploadToBucket`, `createReadStreamAsync`) — none remain.

**Still not verified**: an actual live run — real login setting a real
cookie in a real browser, a real file round-tripping through a real
storage provider, a real cross-origin deployment. Please smoke test those
once you've got Atlas + storage credentials wired up; I'd flag the
cross-origin cookie behavior (`COOKIE_SAMESITE=none` in production) as the
single most likely thing to need a second look, since it's the one piece
that fundamentally can't be verified without two real domains and HTTPS.

---

# Pass 3 — Switched file storage to Cloudinary

You asked for Cloudinary specifically, so `services/storage.js` no longer
has R2/S3 code at all — it's now a clean `local` / `cloudinary` provider
switch, same pattern as before. `@aws-sdk/*` dropped from
`package.json`, replaced with the official `cloudinary` package.

## How it works

- **Upload** (`uploadFile`): buffers go up via `cloudinary.uploader.upload_stream`
  with `resource_type: 'auto'` (Cloudinary picks image/video/raw based on
  content) and, importantly, **`type: 'private'`** — this is what keeps the
  asset off the public CDN entirely; the *only* way to fetch it is a
  signed, time-limited URL (see below). The `public_id` is random
  (`linkvault/<random>/<random>`), never derived from the uploaded
  filename.
- **Download** (`getSignedDownloadUrl`): uses `cloudinary.utils.private_download_url()`,
  which signs the request with your API secret and embeds a
  Cloudinary-enforced `expires_at` (default 300s, `CLOUDINARY_SIGNED_URL_TTL_SECONDS`).
  This is Cloudinary's direct equivalent of an S3/R2 presigned URL — same
  role in the architecture, same one-time-link timing logic from Pass 2
  applies unchanged (delayed purge so the object isn't deleted before the
  browser has had a chance to use the link).
- **Delete** (`deleteFile`): `cloudinary.uploader.destroy()` with
  `type: 'private'` to match how it was uploaded.

I specifically avoided Cloudinary's `type: 'authenticated'` + CDN-signed-URL
combo — that path only works with a CloudFront-backed account (an add-on,
not universally available) per Cloudinary's own support docs. `type:
'private'` + `private_download_url` is the one that's guaranteed to work
on a standard account, at the cost of downloads being served directly by
Cloudinary's API rather than their CDN (fine for a file-sharing app where
most links are used once or a handful of times, not high-traffic hot
files).

### Schema change

`Share.file` gained two Cloudinary-specific fields alongside `objectKey`:
`resourceType` (`image`/`video`/`raw` — Cloudinary needs this to look the
asset back up) and `format` (extension, also required by
`private_download_url`'s signature). The local provider just leaves both
`null` — nothing to migrate since you haven't deployed real data yet.

## Env vars (left empty, as you asked)

```
STORAGE_PROVIDER=local        # switch to `cloudinary` when ready
CLOUDINARY_URL=                              # OR the three below
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_SIGNED_URL_TTL_SECONDS=300
```

`.env.example` documents that you can use either the single
`CLOUDINARY_URL` connection string (what Cloudinary's dashboard gives you
by default) or the three split-out vars — not both required.

## What I verified (no live Cloudinary account available here)

- `node --check` on every changed file; full server boot reaches the same
  MongoDB-connection wall as before (confirms the whole module graph,
  including the new `cloudinary` package, loads without error).
- Local provider re-tested end-to-end after the refactor (upload → signed
  URL → single-use resolve → stream bytes → confirm second use rejected →
  delete) — still passes, unaffected by the Cloudinary changes.
- Confirmed `STORAGE_PROVIDER=cloudinary` fails with a clear, actionable
  error when no credentials are present, rather than a confusing SDK
  failure later.
- **Confirmed the signed URL itself is constructed correctly against fake
  credentials** — `private_download_url` signing is pure local HMAC, no
  network call needed to verify it. Checked the URL lands on
  `api.cloudinary.com`, includes the right `resource_type` in the path,
  `public_id`, `format`, `type=private`, `attachment=true`,
  `expires_at`, and a `signature` — everything Cloudinary's API expects.
- Confirmed the three Cloudinary SDK methods used
  (`uploader.upload_stream`, `uploader.destroy`,
  `utils.private_download_url`) all exist on the installed package
  version.

**Not verified**: an actual upload/download against a real Cloudinary
account — I don't have credentials here, and per your instructions I've
left the placeholders empty in `.env.example` for you to fill in. Once you
do, a quick smoke test (upload a file share, download it, confirm it's
gone from your Cloudinary media library after a one-time link is used)
would be worth doing before you trust this in production.

---

# Note on this copy

This is the **R2 variant** of the project — a separate copy where
`services/storage.js` is Cloudflare R2 (S3-compatible) instead of
Cloudinary, per your request for "one version where files are stored in
R2." Everything else (atomic access control, cookie auth, rate limiting,
sanitization, error codes, indexes from Pass 1-2) is identical between the
two copies.

## R2 specifics

- **Upload** (`uploadFile`): `PutObjectCommand` to a randomly generated key
  (`shares/<random>/<random>.<ext>` - never derived from the uploaded
  filename).
- **Download** (`getSignedDownloadUrl`): `@aws-sdk/s3-request-presigner`
  signs a `GetObjectCommand` with `ResponseContentDisposition` /
  `ResponseContentType` overrides, so the browser gets the right filename
  and content type even though R2 only knows the random key. Default TTL
  300s (`R2_SIGNED_URL_TTL_SECONDS`).
- **Delete** (`deleteFile`): `DeleteObjectCommand`.
- **`forcePathStyle: true`** is set on the S3 client - R2's
  universally-documented-safe addressing mode
  (`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`) rather than
  relying on virtual-hosted-style subdomains, which aren't guaranteed to
  resolve for every account.
- The bucket must be **private** (no public access) - the signed URL is
  the only way in, same as the original blueprint's Phase 3.
- The one-time-link deletion-timing behavior from Pass 2 (delayed purge
  so the object isn't deleted before the browser has had a chance to use
  the signed URL) is unchanged and applies here too.

## Env vars (left empty, as you asked)

```
STORAGE_PROVIDER=local        # switch to `r2` when ready
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_ENDPOINT=                   # optional - defaults from R2_ACCOUNT_ID
R2_SIGNED_URL_TTL_SECONDS=300
```

## What I verified (no live R2 account available here)

- `node --check` on every file; full server boot reaches the same
  MongoDB-connection wall as before (confirms `@aws-sdk/client-s3` +
  `@aws-sdk/s3-request-presigner` load cleanly).
- Local provider re-tested end-to-end (upload → signed URL → single-use
  resolve → stream bytes → confirm second use rejected → delete) - passes.
- Confirmed `STORAGE_PROVIDER=r2` fails with a clear, actionable error
  when credentials are missing.
- **Confirmed the presigned URL is constructed correctly against fake
  credentials** - AWS SigV4 signing is pure local crypto, no network call
  needed to verify it. Checked: path-style host
  (`fake-account.r2.cloudflarestorage.com`), correct bucket/key in the
  path, a valid signature, the configured TTL, and both the
  `Content-Disposition` and `Content-Type` response overrides landing
  correctly in the URL.
- Client builds cleanly - unchanged from the Cloudinary copy, since
  `ViewShare.jsx`'s download handler only ever consumes a generic
  `{ downloadUrl }` and doesn't care which provider produced it.

**Not verified**: an actual upload/download against a real R2 bucket. Once
you've filled in the credentials, a quick smoke test (upload a file share,
download it, confirm a one-time link's object actually disappears from
the bucket after use) is worth doing before trusting this in production.

---

# Pass 4 — Code review fixes (download authority, rollback, cleanup retry, timezones, CSRF)

You sent a code review with five specific architectural fixes plus a
handful of smaller ones. All implemented below.

## 1. `/shares/:id/download` is now the sole, authoritative access point

Reverted the signed-URL redirect from Pass 2/3. The route now does exactly
the flow you specified: find share → check expiry → check password →
atomically consume the download → `GetObject` from R2 → stream straight
into the response. `services/storage.js` dropped `getSignedDownloadUrl`
entirely and replaced it with `getObjectStream(objectKey)`, which both
providers implement (R2 via `GetObjectCommand`, local via
`fs.createReadStream`). The `/shares/_raw/:token` indirection route is
gone - it existed only to give the local provider the same signed-URL
shape, which is no longer needed now that both providers stream through
the same endpoint.

For one-time links, `consumed` is still set atomically in the same
`findOneAndUpdate` as the counter increment, *before* the storage fetch
starts - unchanged from Pass 2, just now it's the only download path
instead of one of two.

**On the "exactly-once" question**: if `GetObjectCommand` fails after the
counter/`consumed` flag is already committed, the code does not try to
roll that back. It logs loudly (`Storage fetch failed for share X after
access was granted`) and returns a clean `500 INTERNAL_ERROR`. Per your
framing, that's one successful *authorized* download attempt, not a
guarantee the bytes arrived - rolling the counter back would just reopen
the exact race the atomic update exists to prevent.

Frontend: `ViewShare.jsx`'s download button went back to a
`responseType: 'blob'` fetch + a locally-triggered save-as, since there's
no more separate URL to navigate to.

## 2. Upload rollback

`POST /shares` now wraps `Share.create()` in its own try/catch. If it
throws and a file was uploaded, the just-uploaded object is deleted
before re-throwing:

```
Upload to storage
   ↓
Create Mongo document
   ↓ (fails)
delete the object we just uploaded
   ↓
re-throw the original error
```

If the rollback delete itself fails, that's logged clearly rather than
swallowed, since at that point there's a genuinely orphaned object with
nothing to auto-heal it.

## 3. Cleanup now actually retries on storage failure

The previous code had a real bug here: `deleteFile(...).catch(() => {})`
swallowed any storage-deletion error and then deleted the Mongo document
*anyway*, silently orphaning the object. Fixed `purgeShare()` to follow
exactly the policy you described - delete the storage object first; only
delete the Mongo document if that succeeds; if it fails, leave the record
in place and let it get picked up by the same 60s cleanup cycle next
time (no new retry machinery needed, since the cycle already re-scans
every expired share on each run). I wrote a test that mocks a failing
delete and confirms `Share.deleteOne` is never reached - see "What I
verified" below.

## 4. Expiry timestamps

Found the actual bug: `Upload.jsx` was sending the raw
`<input type="datetime-local">` value (e.g. `"2026-12-25T14:30"`, no
timezone) straight to the API. `new Date()` on a string like that gets
interpreted in whatever timezone the *reading* code runs in - fine when
that's the same browser that made the picker, silently wrong the moment
it's parsed anywhere else (i.e., the server). Fixed to convert client-side
before sending:

```js
const asDate = new Date(expiresAt)      // interpreted in the browser's own timezone - correct
fd.append('expiresAt', asDate.toISOString())   // sent as an unambiguous UTC instant
```

`MyShares.jsx` and `ViewShare.jsx` were already displaying expiry via
`new Date(iso).toLocaleString()` (local timezone) - no bug there, already
matched the rule you laid out: **DB stores UTC, API is ISO-8601 UTC,
frontend displays local**.

## 5. CSRF / Origin checking

New `middleware/csrf.js` exports `requireTrustedOriginIfCookie`, applied
to `POST /shares` and `DELETE /shares/:id` (the two authenticated,
state-changing endpoints) - `POST /auth/login` is intentionally left
unchecked, matching your example.

One refinement beyond your example: the check only fires when the
request actually carries a session **cookie**. Bearer-token requests
(non-browser API clients) and manage-token deletes aren't vulnerable to
CSRF in the first place, since CSRF specifically exploits a cookie's
*ambient* authority - a request that had to be handed an explicit token
isn't riding on anything a malicious page could trigger. This also means
the check doesn't accidentally break legitimate scripted/API usage that
was never using cookies to begin with.

Why this matters even with CORS already restricting `credentials: true`
requests to an origin allowlist: CORS blocks a script from *reading* a
cross-origin response, but a plain HTML `<form method="POST">` submission
is a "simple request" that browsers send (and, depending on
`SameSite`, may attach cookies to) without ever triggering a CORS
preflight at all. That's exactly the gap Origin-checking closes,
especially relevant for a production deployment using
`COOKIE_SAMESITE=none` (required for the frontend/backend-on-different-
domains case from Pass 2).

## Smaller fixes

- **JWT lifetime**: already finite (`JWT_EXPIRES_IN=7d` default) since
  Pass 2 - confirmed, no change needed.
- **`GET /api/v1/auth/me`**: already existed since Pass 2 but wasn't being
  called anywhere. `App.jsx` now calls it on mount and reconciles the
  `lv_authed` localStorage hint against the real session, so a stale hint
  (e.g. an expired cookie, or logged out in another tab) gets corrected
  automatically instead of just trusting whatever was last written to
  localStorage.
- **Error response codes**: already matched your requested table exactly
  since Pass 1 (`INVALID_REQUEST`→400, `UNAUTHORIZED`→401, `FORBIDDEN`→403,
  `SHARE_NOT_FOUND`→404, `SHARE_EXPIRED`→410, `FILE_TOO_LARGE`→413,
  `RATE_LIMITED`→429, `INTERNAL_ERROR`→500) - no change needed.
- **`.env.example`**: dropped the now-unused `*_SIGNED_URL_TTL_SECONDS`
  vars (no signed URLs anymore) and added an explicit rotate-your-
  credentials reminder next to the R2 section.
- **Credential rotation**: repeating this clearly since it's easy to miss
  in a wall of text - **if the Mongo Atlas connection string that shipped
  in your original ZIP's `.env` was ever a real, working credential,
  rotate it.** I've never included `.env` in anything I've handed back,
  but I can't verify from here whether that string was live.

## What I verified in this pass

- `node --check` on every changed/new file; full server boot reaches the
  same MongoDB-connection wall as before (confirms `middleware/csrf.js`
  and the rewritten `storage.js`/`shares.js`/`cleanup.js` all load
  cleanly together).
- **Local storage direct-streaming round trip**: upload → `getObjectStream`
  → read back the exact bytes → delete → confirm a subsequent
  `getObjectStream` throws. Pass.
- **R2 provider**: confirmed all three functions (`uploadFile`,
  `deleteFile`, `getObjectStream`) fail with the same clear, actionable
  error when credentials are missing (no live network needed to check
  this).
- **Cleanup retry semantics, both branches, with a real test**: mocked
  `Share.deleteOne` and ran `purgeShare()` against (a) a storage deletion
  that fails (`STORAGE_PROVIDER=r2` with no credentials) - confirmed
  `deleteOne` is *never* called, and (b) a storage deletion that succeeds
  (real local file) - confirmed `deleteOne` *is* called. This is exactly
  the bug that existed before, now covered by an explicit test.
- **CSRF middleware, five scenarios**: no cookie → allowed (bearer/API
  clients unaffected); cookie + trusted origin → allowed; cookie +
  untrusted origin → rejected; cookie + no Origin/Referer at all →
  rejected; cookie + trusted Referer (Origin header missing) → allowed.
  All five behave as designed.
- **Timezone conversion**: simulated a browser in `Asia/Kolkata` picking a
  `datetime-local` value, confirmed the wall-clock time is preserved and
  converted to the correct UTC instant regardless of what timezone the
  Node process itself runs in.
- Client builds cleanly (`vite build`).
- Grepped the whole repo for stale references to the removed signed-URL
  functions/routes (`getSignedDownloadUrl`, `resolveLocalSignedToken`,
  `_raw/`, etc.) - none remain.

**Still not verified**: an actual live run against real Mongo/R2/two real
browser sessions - same limitation as every prior pass, no network path
to either service from this sandbox. Given how much of this pass was
specifically about failure-path behavior (rollback, cleanup retry), I'd
suggest testing those two things deliberately once you're live - e.g.
temporarily break R2 credentials mid-test and confirm a cleanup cycle
doesn't delete the Mongo record, and try creating a share with a
deliberately-invalid Mongo write (hard to force, but worth a code-level
double-check) to confirm the rollback path fires.




