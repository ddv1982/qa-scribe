# Configure AI through environment variables first

qa-scribe will read AI provider configuration from environment variables for the MVP and will not store API keys in its own database. This keeps capture usable without AI, makes provider calls explicit, and avoids introducing app-managed secret storage before the product has proven its generation workflow.
