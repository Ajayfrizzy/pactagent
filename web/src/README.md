# Web source map

- `app/`: Next.js routes, layouts, and global styles
- `features/`: product-specific components and browser logic
- `components/`: reusable, feature-neutral UI
- `lib/`: API clients, external integrations, and shared browser state
- `hooks/`: hooks used across unrelated features

Keep route files focused on route concerns and page composition. When a group of
components, state, and helpers serves one capability, place it under
`features/<feature>/` and expose a small `index.ts` entry point.
