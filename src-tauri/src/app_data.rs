//! The app data directory holds Sessions, chat history and screenshots, so it
//! is private to the user who runs QA Scribe.
use std::{io, path::Path};

/// Create the app data directory if needed and make it owner-only on Unix.
/// The mode is also applied to an existing directory, so profiles created by
/// older versions with the default umask become private on the next start.
/// Everything inside is unreachable for other users once this directory is
/// 0700, whatever the modes of the files in it. A filesystem that rejects
/// the mode change (some network or FUSE mounts) only gets a warning, so the
/// app still starts.
pub fn ensure_private_app_data_dir(path: &Path) -> io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)) {
            eprintln!("qa-scribe could not make the app data folder private: {error}");
        }
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::ensure_private_app_data_dir;

    #[test]
    fn new_and_existing_app_data_directories_become_owner_only() {
        let root =
            std::env::temp_dir().join(format!("qa-scribe-app-data-{}", uuid::Uuid::new_v4()));
        let fresh = root.join("fresh");
        ensure_private_app_data_dir(&fresh).unwrap();
        assert_eq!(
            std::fs::metadata(&fresh).unwrap().permissions().mode() & 0o777,
            0o700
        );

        let existing = root.join("existing");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::set_permissions(&existing, std::fs::Permissions::from_mode(0o755)).unwrap();
        ensure_private_app_data_dir(&existing).unwrap();
        assert_eq!(
            std::fs::metadata(&existing).unwrap().permissions().mode() & 0o777,
            0o700
        );

        std::fs::remove_dir_all(root).unwrap();
    }
}
