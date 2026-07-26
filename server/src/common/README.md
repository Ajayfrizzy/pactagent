# Shared server infrastructure

This directory contains server-runtime capabilities shared by multiple business
modules: HTTP middleware, errors, observability, security, tenancy, resilience,
rate limiting, migrations, and lifecycle handling.

Code belongs here only when it has multiple consumers and no single product
feature owns it. Business workflows and feature-specific policies belong under
`../modules/<feature>/`.
