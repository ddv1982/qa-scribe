# Run a small QA Scribe pilot

Invite about five QA engineers who do exploratory testing and have not used QA Scribe. Include supported macOS and Linux environments. The operator recruits participants. This guide does not authorize contact, recording, or issue submission.

Use the pilot to identify barriers to a useful first task and reasons to return. Five participants provide qualitative observations, not adoption percentages or a release gate.

## Prepare and obtain consent

1. Agree on a disposable testing task and a reporting destination the participant normally uses.
2. Record the app version, OS, installer, and relevant experience. Use an anonymous participant ID in the log.
3. Explain what you want to observe, what you will retain, who can access it, and when you will delete it. Obtain consent before any screen, audio, or text capture.
4. Let the participant decline recording, pause, or withdraw. Avoid customer content, credentials, and personal data. Use observer notes when recording is declined.
5. Agree separately whether optional AI is in scope. A participant needs no AI account for the ordinary task. Use only an account they already have permission to use.

## Observe an ordinary task

Give neutral outcome instructions. Do not name buttons or demonstrate the flow first.

1. Ask, "Install and open QA Scribe using the download instructions." Record installation problems separately.
2. Ask, "Test this required-field behavior. Keep enough evidence for a colleague to understand what happened."
3. Ask, "Prepare a useful Finding or test case for that colleague."
4. Ask, "Put that result into your usual reporting tool, including the screenshot you want to share."
5. Ask, "Close the app, return to your work, and find the saved result."

Let the participant decide whether the example or Help is useful. Observe where they look, what they expect, and which output they trust. Record whether the real paste contains the intended text and image. Do not equate a Copy success message with a successful handoff.

If the participant gets stuck, record the point and their explanation before offering the smallest useful hint. Log the hint and whether it was necessary to finish. Stop if the participant wants to stop.

Afterward, ask what they expected, what was missing, and what would make this worth using during their next suitable task. If AI is in scope, observe provider installation, authentication, readiness, and an explicit request separately. Do not hide setup assistance inside the ordinary task result.

## Observe opportunities to return over two weeks

Invite voluntary use during suitable work over two weeks. Agree on one midpoint check-in and one closing conversation. The operator arranges those conversations with permission. Do not add telemetry or scheduled messages.

At each check-in, ask whether another suitable testing task occurred. If one occurred, ask whether they used QA Scribe, reopened previous work, copied output, needed help, or chose another tool. Record the reason in their words. No opportunity to return is different from choosing not to return.

Do not ask participants to buy services or create provider accounts for this pilot. Keep AI setup problems separate from the value of ordinary capture and output.

## Keep a manual result log

Copy this header into an access-controlled local text file or spreadsheet. Add one row per task or return opportunity. Store consent records separately.

```text
participant_id | app_version | os | date | stage | suitable_task_opportunity | outcome | assistance_given | output_usable | text_paste_result | screenshot_paste_result | reopened_work | return_choice_and_reason | observation_or_quote | consent_and_capture_reference
```

Use stages such as installation, first task, reporting handoff, optional AI, and return opportunity. Use descriptions such as completed unaided, completed after a named hint, stopped, or no suitable opportunity. Record failures and skipped actions. Keep observed behavior separate from participant opinion.

Review the log after the sessions. Choose a small follow-up for the strongest repeated barrier. Report the sample, OS coverage, task differences, assistance, and missing evidence. Do not claim a measured adoption rate or hold a safe release solely for the two-week window.
