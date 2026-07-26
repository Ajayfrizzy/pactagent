# Legacy product services

Most files here support the optional legacy `/api` product surface. New `/v1`
business logic belongs in `../modules/<feature>/`.

Some provider and queue services are also consumed by newer modules. Move those
only in focused changes that leave compatibility exports here until all callers
have migrated.
