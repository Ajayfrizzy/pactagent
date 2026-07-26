# Legacy API routes

These routes implement the optional wallet-product API mounted under `/api` when
`ENABLE_LEGACY_PRODUCT_API=true`. New `/v1` endpoints belong under
`../modules/<feature>/`.

Do not move an individual route without migrating its service dependencies and
covering the compatibility behavior with tests. This directory is intentionally
kept distinct until the legacy product API is retired or migrated feature by
feature.
