# SPACExPRO Hackathon — standalone edition

This folder is the standalone (local) edition of the SPACExPRO Hackathon
platform. It runs on Windows, macOS and Linux with only Bun installed:

```sh
bun install
bun run dev   # http://localhost:3000
```

Layout: React client in `client/`, server actions in
`server/src/actions.ts`, schema in `server/src/schema.ts`, Drizzle SQL
migrations in `drizzle/`, and the local runtime (dev server, SQLite
setup, and the local `@hatch/space-sdk` replacement) in `local/`.
See `README.md` for the full guide and `START-HERE.txt` for the
one-page quick start.

Notes:
- The local database is `app.db` in this folder (created on first run;
  delete it to reset). It is never shipped in the ZIP.
- Local email delivery is intentionally absent: queued mail stays
  "pending" in the Organizer outbox and is never marked sent.
- The hosted Muse version of this project keeps the slug
  `orbitx-hackathon` in `space.json` for continuity; it is internal
  metadata only and is not used by the local server.
