use super::super::{
    ProviderCatalogState, ProviderDiscoveryError, ProviderDiscoveryErrorCode, ProviderState,
    detection::detect_provider,
    probe::{CodexDefaultsProbe, CommandProbe, DetectionMode, ProbeRunner},
};
use qa_scribe_core::domain::AiProvider;
use std::{
    cell::{Cell, RefCell},
    path::PathBuf,
};

struct CatalogBudgetRunner {
    budget_exhausted: Cell<bool>,
    authenticated: bool,
    observed: RefCell<Vec<&'static str>>,
}

impl ProbeRunner for CatalogBudgetRunner {
    fn executable_path(&self, _: &str) -> Option<PathBuf> {
        Some(PathBuf::from("/synthetic/codex"))
    }
    fn run(&self, program: &str, args: &[&str]) -> CommandProbe {
        assert_eq!(program, "codex");
        match args {
            ["--version"] => {
                self.observed.borrow_mut().push("version");
                CommandProbe::success_with_stdout("codex fixture")
            }
            ["login", "status"] => {
                self.observed.borrow_mut().push("authentication");
                if !self.budget_exhausted.get() && self.authenticated {
                    CommandProbe::success()
                } else {
                    CommandProbe::failed("authentication command did not succeed")
                }
            }
            ["debug", "models"] => {
                CommandProbe::failed("catalog transaction exhausted the command budget")
            }
            _ => panic!("unexpected probe arguments: {args:?}"),
        }
    }
    fn codex_app_server_defaults(&self) -> CodexDefaultsProbe {
        self.observed.borrow_mut().push("catalog");
        self.budget_exhausted.set(true);
        CodexDefaultsProbe::Failed(ProviderDiscoveryError {
            code: ProviderDiscoveryErrorCode::TimedOut,
            message: "synthetic catalog timeout".into(),
            retryable: true,
        })
    }
}

#[test]
fn catalog_budget_exhaustion_preserves_the_real_authentication_observation() {
    for authenticated in [true, false] {
        let runner = CatalogBudgetRunner {
            budget_exhausted: Cell::new(false),
            authenticated,
            observed: RefCell::new(Vec::new()),
        };
        let readiness = detect_provider(AiProvider::CodexCli, &runner, DetectionMode::Deep);
        assert_eq!(
            readiness.descriptor.status,
            if authenticated {
                ProviderState::Ready
            } else {
                ProviderState::AuthRequired
            }
        );
        assert_eq!(readiness.descriptor.available, authenticated);
        assert_eq!(
            readiness.descriptor.catalog_snapshot.state,
            ProviderCatalogState::Failed
        );
        assert_eq!(
            readiness
                .descriptor
                .catalog_snapshot
                .error
                .as_ref()
                .map(|error| error.code),
            Some(ProviderDiscoveryErrorCode::TimedOut)
        );
        assert_eq!(
            readiness
                .descriptor
                .default_snapshot
                .error
                .as_ref()
                .map(|error| error.code),
            Some(ProviderDiscoveryErrorCode::TimedOut)
        );
        assert_eq!(
            &runner.observed.borrow()[..3],
            &["version", "authentication", "catalog"]
        );
    }
}
