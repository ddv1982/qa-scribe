// Rust owns the bridge: types, the `commands` module, and provider-default
// constants are generated into `bindings.ts` by tauri-specta. The app-facing
// command wrappers live in `tauriCommands.ts`. Re-export both from here so the
// rest of the app keeps importing from `./tauri`.
export * from './bindings'
export * from './tauriCommands'
