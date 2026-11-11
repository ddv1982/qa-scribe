# Notes Ask AI polish

Keep Notes and its conversation in the same Session section. Reuse the working
conversation engine and persisted mode; this change introduces no storage,
backend protocol, or conversation lifecycle changes.

1. **Entry and layout:** replace Write note / Chat with Ask AI beside the Note.
   Keep the editor mounted and editable beside the panel; show the panel alone
   in narrow windows, with Close returning to the Note and its Ask AI button.
2. **Shared presentation:** use the existing record panel's header, source card,
   transcript spacing, and pinned composer. Move Notes model selection, provider
   setup, restart, and usage details into Conversation options. Preserve Notes
   submission, recovery, questions, images, tools, and its separate history.
3. **Proof and review:** verify retained text/images on close and reopen, Note
   handoff, record isolation, tool permission, keyboard access, and short windows
   with the maintained native journeys. Run the repository gate and Sol review.
4. **Ship:** merge the reviewed change after hosted CI is green. Prepare the next
   patch version with `bun run bump`, merge its release PR after CI, and let the
   merge-triggered Release workflow create the tag, build/sign installers,
   publish APT, and publish the GitHub release. Verify publication before handoff.
