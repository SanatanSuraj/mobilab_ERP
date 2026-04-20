-- Mobilab ERP — extensions required globally.
--
-- uuid-ossp: server-side UUID generation fallback (we usually use gen_random_uuid
--            from pgcrypto, but some tooling expects uuid-ossp too).
-- pgcrypto:  gen_random_uuid(), digest() for token hashing.
-- citext:    case-insensitive text columns (used for emails in Phase 2+).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
