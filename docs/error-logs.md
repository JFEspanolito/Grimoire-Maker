# Error logs

Desktop errors are written to `errors-0001.txt` through `errors-0016.txt` in **Settings → Preferences → Logs Path**. The default is `logs` inside the application configuration directory. `setting.json` stores the selected path; the frontend never supplies a filename or raw destination to the append command.

Changing Logs Path uses the same guarded copy operation as other library directories. It copies existing files, retains the originals, refuses collisions and links/reparse points, and publishes the new path only after successful copying. Appending and switching share one native lock: subsequent errors go to the selected directory without restarting. A failed switch keeps the old active path; inspect partial copies before retrying with a clean destination.

## Captured errors

- Uncaught window errors and unhandled promise rejections after logging initialization.
- `console.error`, while retaining the original console behavior.
- Workspace, theme, template, and mod error-store updates, including errors already present at initialization.
- Explicit `reportError(source, error)` calls for locally handled failures.
- Native configuration/startup failures and Rust panics, best effort. A malformed preferences file falls back to the checked default Logs directory for these native diagnostics only.

Entries identify their source and UTC Unix timestamp (seconds plus milliseconds since 1970-01-01 UTC). JavaScript `Error` values retain their message and stack. Other objects are not serialized; safe primitive text is accepted. Common credential assignments and bearer tokens are redacted in frontend messages. Redaction is best effort: **logs may contain local paths, exception text, or other sensitive details. Inspect and redact the text before sharing it.** Do not put document contents or credentials into error messages.

## Limits and retention

Individual messages are limited to 16 KiB in native storage. Repeated identical frontend messages are deduplicated for five seconds across sources. The frontend also bounds pending writes and recent distinct errors to avoid an unbounded error storm.

Each segment holds at most 1 MiB; rotation uses the next available numbered segment without overwriting or deleting old logs. The sixteen reserved segments cap generated storage at 16 MiB. Other user files are neither appended to nor deleted. Logging stops at capacity and emits a one-time console warning. To resume, close the app and manually archive the numbered files outside Logs Path, then restart. Merely selecting another directory copies the full logs too, so it does not clear capacity. Preserve files you need before removing them yourself.

Logger failures do not recursively create more logs or change the original application operation. Directory/file links, reparse points, and hard-linked log files are rejected. Windows directory/file handles prevent path replacement while writing. Native filesystem safety is verified on Windows; other platform-specific behavior requires testing on that platform.

Browser-only development never invokes native logging. Deliberately swallowed errors require an explicit `reportError` call and are not automatically observable. Errors during module loading before initialization, forced termination, OS/process crashes, disk failure, and panics while the shared native lock is held may not reach disk. This is diagnostic error logging, not a guarantee that every crash can be recovered.
