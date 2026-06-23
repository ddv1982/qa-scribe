use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
pub struct JobStore {
    jobs: Mutex<HashMap<String, String>>,
}

impl JobStore {
    pub fn len(&self) -> usize {
        self.jobs.lock().map(|jobs| jobs.len()).unwrap_or_default()
    }
}
