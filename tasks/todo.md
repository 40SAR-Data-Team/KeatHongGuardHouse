# Tag-targeted public blast

Goal: creator limits the public-open DM to users holding ALL chosen tags. No tags chosen = everyone (default). Private groups unchanged. Feed/join unchanged (tags only gate who gets the DM).

## Model
- Tag = (kind, value). kinds: unit, company, platoon, section, role. role values fixed: commander | trooper. Others free text.
- No tags table. `user_tags(user_id, kind, value)` PK all 3. A tag exists iff some user holds it, so "auto-delete when empty" is free (`select distinct`).
- `group_audience(group_id, kind, value)`: tags the creator chose. Empty = everyone.
- Match: recipient holds every audience tag (AND). Relational division query in `listSubscriberIds`.
- Values normalised on write: trim, collapse spaces, uppercase, max 30 chars, so "alpha" and "Alpha " are one tag. Max 10 tags per user.

## Steps

## Final decisions
- Dedup key ignores case, spaces, punctuation, accents. One tag per kind per user. Creator targets only own tags (client sends kinds). Tags gate DM, feed, detail and join.

## Review
Built; tsc, lint, `bun test shared` pass; generated SQL inspected. NOT run: `bun run db:push` (touches the live DB) and no end-to-end test against a DB.
