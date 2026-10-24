# Capture a test and report a Finding

Use QA Scribe to capture testing evidence, create a Finding or test cases, and copy useful output into your reporting tool. This task needs no AI account or developer tools.

## Install QA Scribe

Download an installer for your OS from [GitHub Releases](https://github.com/ddv1982/qa-scribe/releases).

- On macOS, open the `.dmg` and drag QA Scribe into Applications. Choose `aarch64` for Apple Silicon or `x64` for Intel.
- On Linux, install the `.deb` or `.rpm` with your package manager, or mark the `.AppImage` executable and run it. Use a distribution compatible with the release's requirements.

Debian and Ubuntu users can also use the [signed APT repository instructions](../README.md#install).
Open QA Scribe after installation. A fresh library offers **Start a Session** and **Explore an example**. The example is a read-only preview with a synthetic screenshot. It saves nothing and requests no AI.

## Record one checkout check

Use a test shop you have permission to test. Check what happens when you try to submit checkout with a required postcode missing. If your product has a different form, choose a comparable required field.

1. Choose **Start a Session**. A blank Session opens in **Note**.
2. Replace the Session title with `Checkout required postcode`.
3. Write the environment, the steps you tried, and what happened in Note. For example, `Test build, laptop browser. Left postcode empty and chose Place order. A postcode message appeared and no order was created.` Record your actual result.
4. Paste a screenshot into Note, or choose **Upload image** in the formatting toolbar. Check that the screenshot appears. Use test data and exclude personal details.
5. Choose **Create finding**. **New finding** opens as a local, unsaved draft with shared document sections. Opening it saves no blank record and makes no AI request.
6. Give the Finding a title. Describe the steps, expected behavior, actual behavior, and impact. A Finding can record a passed check as well as a bug.
7. Choose **Save finding**. Check that your saved Finding appears in the Session's **Findings** tab.

For a reusable check, choose **Create test cases**, select **Output format**, fill in the starter sections, and choose **Save test cases**. Choose QA cases, Checklist, Gherkin, Charters, or Coverage outline. Empty sections are optional. Findings offer **Template** choices for Structured finding or Blank. If you change the format after writing, choose **Keep editing** to retain your body or **Apply format** to replace it. The title and finding details stay intact.

Before leaving an authored draft, choose **Save draft**, **Discard draft**, or **Keep editing**. Cancelling an untouched draft saves no record. Notes autosave; save a new creation draft before quitting.

## Copy output into your reporting tool

1. Open the Finding and choose **Copy**. Paste into a disposable issue, document, or test record in your usual reporting tool.
2. Check the pasted title, steps, and formatting. Copy supplies formatted text and a plain-text alternative. The destination chooses which format it accepts.
3. If the Finding itself contains a screenshot, choose **Copy first screenshot**. Paste that image separately into the report. A screenshot in Note belongs to Note, so copy that screenshot from Note instead.
4. Add any remaining screenshots manually. Review the report before you submit it.

**Copy** uses the visible title and content, including unsaved edits in the editor. It does not save those edits. In a library, Copy uses the saved record. Images in copied text become references. Copy first screenshot copies only the first managed screenshot in that Note or record, and replaces the clipboard contents with the image.

QA Scribe does not submit the report for you. Your reporting tool may need a different paste target or format. Keep the original evidence until you have checked the result.

## Reopen your work

Notes and Session titles autosave. Wait for **Autosaved** before you quit. Findings and test cases have an explicit **Save** action.

1. Quit and reopen QA Scribe. An existing Session opens without the welcome preview.
2. Select your Session from **Recent sessions**, or use **Search Sessions** to find it. Use **Load All Sessions** when older Sessions are not loaded.
3. Open **Findings** or **Test cases**. Your saved output is also available in the corresponding library.

If a save fails, keep the app open and retain your text before retrying. There is no trash or general undo for deletion.

## Find Help and optional AI

Choose **Help** beside Settings for the workflow, Copy behavior, provider setup, data locations, and feedback. You can also search for **Open Help** in Commands.

Inside either draft, **Prefill from note** lets you review and copy the saved Note's plain text into that same draft, without its formatting or screenshots. For Findings it includes only the first 4,000 characters. Confirm before replacing authored draft text.

For optional AI, follow [AI providers and Session Chat](ai-providers.md#set-up-one-provider), then choose **Generate with AI** inside the draft. Review the saved Note source and the confirmation: success immediately saves one AI result and replaces the local draft. Cancellation or failure keeps the draft. Ordinary writing and Save remain available without a ready provider.

Local data lives under `~/.local/share/io.github.ddv1982.qa-scribe` on Linux, or `$XDG_DATA_HOME/io.github.ddv1982.qa-scribe` when set. On macOS, use `~/Library/Application Support/io.github.ddv1982.qa-scribe`.

For a manual backup, quit QA Scribe and copy the whole app-data directory, including `qa-scribe.sqlite` and `attachments`. There is no in-app backup or restore workflow. Preserve a copy before attempting manual restoration. **Recover Session Note** handles specific interrupted AI or Chat updates, not deleted data.

To report a problem, use [New GitHub issue](https://github.com/ddv1982/qa-scribe/issues/new). Help also offers a selectable URL and **Copy feedback link**. That action copies only the URL for you to paste into your browser. It opens no browser and uploads nothing. Review your issue and remove private material before submitting it.

Contributor setup stays in the [development guide](development.md).
