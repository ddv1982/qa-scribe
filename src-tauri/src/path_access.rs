use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct PathAccess {
    granted_paths: Mutex<HashSet<PathBuf>>,
}

impl PathAccess {
    pub fn len(&self) -> usize {
        self.granted_paths
            .lock()
            .map(|paths| paths.len())
            .unwrap_or_default()
    }
}
