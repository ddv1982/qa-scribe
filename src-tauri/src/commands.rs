// Submodules are `pub(crate)` so `specta_bindings::builder` can reference each
// command by its defining-module path (`commands::sessions::create_session`),
// which is how `collect_commands!` finds the hidden `__cmd__*` macros that the
// `pub use` re-exports below do not carry.
pub(crate) mod ai;
pub(crate) mod entries;
pub mod error;
pub(crate) mod files;
pub(crate) mod findings;
pub(crate) mod generation;
pub(crate) mod providers;
pub(crate) mod sessions;
pub(crate) mod settings;

// The command functions are registered through `specta_bindings::builder`'s
// `collect_commands!` by their module paths, so they need no re-export here.
// Only the shared error type is used across command modules.
pub use error::CommandError;
