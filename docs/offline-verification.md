# Offline robustness verification

Implemented in separate tested commits:

- Queue ownership by staff profile ID; other users' sales are skipped. Legacy rows without ownership remain stored and are flagged for recovery.
- Automatic retry delays of 5, 10, 20, 40, then 60 seconds. Failed requests and failed queue cleanup preserve the sale and do not block later sales.
- Nonnegative local consumable estimates, labelled awaiting sync; confirmed stock is not overwritten by estimates.
- Build-specific service-worker precache includes all 22 published app assets, photos, and backgrounds. Confirmed stock and prices are cached locally. Offline selling requires a previous confirmed stock refresh.
- Pending count, visible retry messages, persisted last successful sync time, and protection against switching users/signing out with owned pending sales.

Verification: 79 automated tests, lint, and production build pass. Tests cover lost responses, serialized queue reopening, expired-session recovery, mixed-user queues, retry backoff, cleanup failure, stock estimates, cache corruption, offline navigation/photo responses, and exclusion of database requests from the service-worker cache. Generated precache paths were checked against build files.

Limits: isolated PostgreSQL concurrency tests could not run because Docker's daemon was unavailable, including after attempting to start Docker Desktop. No production data was changed. Real iPhone airplane-mode, browser storage eviction, and closed-app background syncing remain unverified. Automatic retries run while the app is open; reopen the app to resume after closing it. Cached app resources require a successful online install first. Local estimates cannot see sales from other devices.
