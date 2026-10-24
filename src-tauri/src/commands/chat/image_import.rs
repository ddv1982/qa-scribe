use qa_scribe_core::{attachments::chat::PreparedChatImageImport, domain::*};

use crate::{commands::CommandError, settings::AppState};

pub(super) fn import(
    state: &AppState,
    scope: ChatRevision,
    filename: String,
    data_url: &str,
) -> Result<ChatState, CommandError> {
    import_with(
        state,
        scope,
        filename,
        data_url,
        PreparedChatImageImport::decode,
        |prepared| prepared.write(state.app_data_dir()),
    )
}

fn import_with(
    state: &AppState,
    scope: ChatRevision,
    filename: String,
    data_url: &str,
    decode: impl FnOnce(ChatRevision, String, &str) -> qa_scribe_core::Result<PreparedChatImageImport>,
    write: impl FnOnce(&PreparedChatImageImport) -> qa_scribe_core::Result<()>,
) -> Result<ChatState, CommandError> {
    state.with_service(|service| service.check_chat_image_import(&scope, 0))?;
    let prepared = decode(scope, filename, data_url)?;
    let result = (|| {
        state.with_service(|service| prepared.reserve(service))?;
        write(&prepared)?;
        state.with_service(|service| prepared.commit(service))
    })();
    if result.is_err() {
        let _ = state.with_service(|service| prepared.recover(service, state.app_data_dir()));
    }
    result
}

#[cfg(test)]
mod tests;
