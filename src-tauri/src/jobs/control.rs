use std::{
    process::Child,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Default)]
pub struct JobControl {
    cancel_requested: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    finalization: Arc<Mutex<()>>,
}

impl JobControl {
    pub fn is_cancelled(&self) -> bool {
        self.cancel_requested.load(Ordering::SeqCst)
    }

    pub fn set_child(&self, mut child: Child) -> Result<(), String> {
        let mut slot = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?;
        if self.is_cancelled() {
            crate::process_io::kill_child_group(&mut child);
        }
        *slot = Some(child);
        Ok(())
    }

    pub fn take_child(&self) -> Result<Option<Child>, String> {
        self.child
            .lock()
            .map(|mut child| child.take())
            .map_err(|_| "Generation process lock was poisoned".to_string())
    }

    /// Kill the registered child (and its process group on unix) in place,
    /// without removing or reaping it. Used by cancellation and watchdogs so
    /// the owning worker can still `wait()` on it afterwards.
    pub fn kill_registered_child(&self) -> Result<(), String> {
        if let Some(child) = self
            .child
            .lock()
            .map_err(|_| "Generation process lock was poisoned".to_string())?
            .as_mut()
        {
            crate::process_io::kill_child_group(child);
        }
        Ok(())
    }

    pub(crate) fn request_cancel(&self) -> Result<(), String> {
        self.cancel_requested.store(true, Ordering::SeqCst);
        self.kill_registered_child()
    }

    pub(super) fn run_serialized<R>(&self, operation: impl FnOnce() -> R) -> Result<R, String> {
        let _finalization = self
            .finalization
            .lock()
            .map_err(|_| "Generation finalization lock was poisoned".to_string())?;
        Ok(operation())
    }

    /// Run the persistence boundary only if cancellation has not already won.
    /// Cancellation and persistence serialize here, so an accepted cancel can
    /// never create a generated record afterwards.
    pub(crate) fn run_if_not_cancelled<R>(
        &self,
        operation: impl FnOnce() -> R,
    ) -> Result<Option<R>, String> {
        self.run_serialized(|| {
            if self.is_cancelled() {
                None
            } else {
                Some(operation())
            }
        })
    }

    /// Last-resort process cleanup when a normal cancellation transition could
    /// not be recorded during app exit.
    pub(super) fn kill_child_for_exit(&self) {
        if let Ok(mut slot) = self.child.lock()
            && let Some(child) = slot.as_mut()
        {
            crate::process_io::kill_child_group(child);
        }
    }
}
