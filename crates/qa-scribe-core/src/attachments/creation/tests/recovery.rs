use super::*;

#[test]
fn prepare_long_filename_is_a_definite_validation_rejection_without_an_attempt() {
    for kind in [CreationKind::Finding, CreationKind::Testware] {
        let fixture = Fixture::new();
        let mut prep = preparation(&fixture.session, kind, 1);
        prep.images[0].filename = format!("{}.png", "x".repeat(201));
        let error = fixture.service.prepare_creation_save(prep).unwrap_err();
        assert!(
            matches!(&error, crate::QaScribeError::Validation(message) if message == "Creation image filename must be sanitized and at most 200 bytes")
        );
        eprintln!(
            "{kind:?}: {error}; attempts={}, reservations={}",
            count(&fixture.service, "creation_attempts"),
            count(&fixture.service, "creation_attempt_images")
        );
        assert_eq!(count(&fixture.service, "creation_attempts"), 0);
        assert_eq!(count(&fixture.service, "creation_attempt_images"), 0);
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            0
        );
        assert!(matches!(
            abort_creation_save(&fixture.service, &fixture.root, "attempt"),
            Err(crate::QaScribeError::NotFound(_))
        ));
        let (_, prepared) = fixture.prepare(kind, 1);
        let input = request(&prepared, kind);
        let outcome = commit_creation_save(&fixture.service, &fixture.root, input.clone()).unwrap();
        assert!(matches!(outcome, CreationOutcome::Committed { .. }));
        assert_eq!(
            commit_creation_save(&fixture.service, &fixture.root, input).unwrap(),
            outcome
        );
        assert_eq!(
            count(&fixture.service, "findings") + count(&fixture.service, "drafts"),
            1
        );
    }
}
