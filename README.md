# LinkVault

LinkVault is a lightweight file and text sharing application that lets users create temporary, shareable links with optional password protection and access limits.

It is designed as a small-scale web application with a simple architecture: a React frontend, a Node.js/Express backend, MongoDB for metadata, and Cloudflare R2 for file storage.

## Features

- Share plain text or files through short URLs
- Optional password protection using bcrypt-hashed passwords
- Configurable link expiry
- One-time access support
- Maximum view/download limits
- Authenticated share management and deletion
- Private file storage through Cloudflare R2
- Atomic access-limit enforcement to avoid race conditions
- HTTP-only cookie-based JWT authentication
- Rate limiting for authentication and public share access
- Basic CSRF protection for cookie-authenticated state-changing requests
- Automatic cleanup of expired shares
- MIME-type and file-extension validation
- File size limit for uploads

## Architecture

```text
                    ┌─────────────────────┐
                    │   React + Vite      │
                    │     Frontend        │
                    └──────────┬──────────┘
                               │ HTTPS / REST API
                               ▼
                    ┌─────────────────────┐
                    │  Node.js + Express  │
                    │      Backend        │
                    └──────┬───────┬──────┘
                           │       │
                    metadata      │ files
                           │       │
                           ▼       ▼
                    ┌──────────┐  ┌──────────────┐
                    │ MongoDB  │  │ Cloudflare R2│
                    │  Atlas   │  │ Private      │
                    └──────────┘  └──────────────┘
```

### Storage model

MongoDB stores share metadata such as the short ID, owner, expiry, access counters, password hash, and file metadata.

Cloudflare R2 stores the actual file objects. The R2 bucket remains private; downloads are authorized by the backend before the file is streamed to the client.

## Tech Stack

### Frontend

- React
- Vite
- React Router
- Axios
- Tailwind CSS

### Backend

- Node.js
- Express
- MongoDB + Mongoose
- JWT
- bcrypt
- Multer
- Helmet
- CORS
- Morgan
- node-cron
- AWS SDK for JavaScript v3 (S3-compatible R2 API)

### Storage

- Cloudflare R2

## Project Structure

```text
linkvault/
├── client/
│   ├── src/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
│
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── jobs/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── utils/
│   │   └── index.js
│   ├── .env
│   └── package.json
│
└── README.md
```

## Core API

Base URL:

```text
/api/v1
```

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Register a user |
| POST | `/auth/login` | Login and create an HTTP-only session cookie |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Get the current authenticated user |

### Shares

| Method | Endpoint | Description |
|---|---|---|
| POST | `/shares` | Create a text/file share |
| GET | `/shares/:id` | View share metadata/content |
| GET | `/shares/:id/download` | Download a file share |
| GET | `/shares/me` | List the authenticated user's shares |
| DELETE | `/shares/:id` | Delete a share |

## Share Access Rules

A share can be configured with:

- `expiresAt` — absolute expiry time
- `oneTime` — consume the share after the allowed access
- `maxViews` — maximum number of accesses/downloads
- `password` — optional password protection

Access limits are enforced atomically in MongoDB rather than using a separate read-then-update sequence. This prevents concurrent requests from bypassing view/download limits.

## Security

### Authentication

JWTs are stored in an HTTP-only cookie rather than browser local storage. The frontend uses Axios with credentials enabled and calls `/auth/me` to reconcile the current session.

### Password protection

Share passwords are never stored in plaintext. They are hashed using bcrypt and compared during access.

### Rate limiting

The backend applies rate limits to authentication and public share operations. Password-protected shares also use temporary per-share/IP lockout after repeated failed password attempts.

### CSRF protection

Cookie-authenticated state-changing requests are restricted to the configured trusted frontend origin using the request `Origin`/`Referer` headers.

### File validation

Uploads are checked using:

- maximum file size
- allowed MIME prefixes/types
- blocked file extensions
- sanitized filenames
- randomly generated storage object keys

### Private R2 storage

The R2 bucket is private. Clients never receive unrestricted public bucket access. The backend validates expiry, password, one-time rules, and access limits before streaming a file from R2.

## Environment Variables

Create:

```text
server/.env
```

Example:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/linkvault

JWT_SECRET=replace-with-a-long-random-secret
JWT_EXPIRES_IN=7d

COOKIE_SAMESITE=lax
COOKIE_SECURE=false

STORAGE_PROVIDER=r2

R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=link-vault
R2_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com

DEFAULT_EXPIRY_MINUTES=10
MAX_FILE_SIZE_MB=20
ALLOWED_MIME_PREFIXES=image/,text/,application/pdf,application/zip
BLOCKED_EXTENSIONS=
```

### R2 configuration

For a normal R2 bucket, the endpoint is:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

For an EU-jurisdiction bucket, use:

```text
https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
```

The API token should be restricted to the LinkVault bucket with **Object Read & Write** permission.

Do not commit `.env` or expose the R2 secret access key in frontend code.

## Local Development

### 1. Clone the repository

```bash
git clone <your-repository-url>
cd linkvault
```

### 2. Configure the backend

```bash
cd server
npm install
```

Create `server/.env` using the example above.

Start the backend:

```bash
npm start
```

### 3. Configure the frontend

Open another terminal:

```bash
cd client
npm install
```

Create `client/.env`:

```env
VITE_API_BASE=http://localhost:4000/api/v1
```

Start the frontend:

```bash
npm run dev
```

The application will normally be available at:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:4000
```

## Production Deployment

Recommended deployment layout:

```text
React/Vite     → Vercel
Node/Express   → Render
MongoDB        → MongoDB Atlas
File storage   → Cloudflare R2
```

### Backend production settings

Set the production environment variables in the Render service instead of committing secrets to the repository.

For a frontend and backend hosted on different domains, configure the cookie settings appropriately, for example:

```env
COOKIE_SAMESITE=none
COOKIE_SECURE=true
```

Set `CLIENT_ORIGIN` to the exact deployed frontend origin.

### Frontend production setting

Set:

```env
VITE_API_BASE=https://<your-backend-domain>/api/v1
```

## Access Flow

```text
User requests share
        │
        ▼
Validate expiry / password / limits
        │
        ▼
Atomically reserve access
        │
        ▼
Text → return content

File → fetch object from private R2
        │
        ▼
Stream file through backend
```

This design keeps the access-control logic in the backend instead of exposing reusable R2 download URLs.

## Cleanup

A scheduled `node-cron` job periodically searches for expired shares.

For file shares:

1. Delete the object from R2.
2. Delete the corresponding MongoDB document.

If storage deletion fails, the database record is retained so a later cleanup cycle can retry the operation.

## Configuration Defaults

- Default link expiry: 10 minutes
- Maximum file size: 20 MB
- Storage provider: Cloudflare R2
- Cleanup interval: every minute

These values can be changed through environment variables or backend configuration.

## Testing Checklist

Before deployment, verify:

- User registration and login
- Session persistence after page refresh
- Text share creation and access
- File upload to R2
- File download from R2
- Password-protected share
- Incorrect password handling
- Expired share rejection
- One-time share behavior
- Maximum view/download limits
- Share deletion
- Expired-share cleanup
- R2 object deletion after cleanup

## Notes

LinkVault intentionally uses a single backend service with MongoDB and R2. It does not require microservices, Redis, Kafka, Kubernetes, or other distributed infrastructure for its intended small-scale workload.

## License

Add your preferred license here, for example MIT.