# Local source control

The Source control panel at the bottom of the project sidebar uses the system Git executable. Install Git and make it available on `PATH`; missing Git and identity errors appear in the panel.

1. Open a project. If it has no repository, click **Initialize Git repository** explicitly. Initialization is refused inside an enclosing repository: open that repository root or use a separate project folder instead.
2. Save editor changes before staging. The panel only reads files on disk; unsaved buffers are not included.
3. Refresh to see the branch and staged, unstaged, and untracked files. Select a file to preview its text diff. Renames retain their source path; binary files have no text preview. Large previews are truncated to 512 KiB.
4. Use **+** to stage a file or **−** to unstage it. Unstaging changes only the Git index, not files on disk. A file may appear in both sections when its staged version differs from its current contents.
5. Enter a message and choose **Commit staged**. This commits **all currently staged files**, including files staged outside the application. Review the staged list first and unstage anything unwanted. Unstaged and untracked files are never automatically added. A changed index or HEAD since refresh is rejected; refresh and review again.

## Safety and limitations

- Operations are restricted to the canonical active workspace recorded in app state. A repository root must match that workspace exactly. The application never uses an enclosing parent repository accidentally.
- Git is launched with argument arrays, never through a shell. Paths are literal, validated against the reported changed files, and rejected if they traverse outside the project or through symbolic links. Linked worktrees, redirected `.git` metadata, and symlinked Git metadata are intentionally unsupported.
- **Hooks, signing, filesystem-monitor helpers, external diff/textconv programs, and clean/smudge/process filters are bypassed.** This prevents executing project-provided helpers. It also means Git LFS/custom-filter repositories may require an external Git client to stage correctly; the panel stages the raw file rather than applying those filters. Use an external client when hook validation, signing, or filters are required.
- Git identity is read from existing Git configuration. The application never invents an identity and never changes your local or global Git configuration. Missing identity must be configured explicitly outside the application.
- No fetch, push, remote access, credential prompts, reset, checkout, discard, or automatic commits are exposed. Merge, cherry-pick, revert, and rebase commits must be completed in an external client.
- Non-UTF-8 filenames are rejected rather than silently converted. Git status beyond 512 KiB is rejected rather than presenting an incomplete staged list. Submodule contents are not handled by this panel.
- Commands run off the UI thread and are serialized within this application. Each child process is limited to 20 seconds with bounded output. A timeout can occur after an operation has completed; refresh before retrying. Avoid changing the index concurrently in another client: the freshness check detects changes before commit but does not provide a cross-process transaction with external tools.

## Integration

Mount `VersionControlPanel` with `workspace: string | null` and optional `hasUnsavedChanges: boolean`. The public native commands are `git_status`, `git_diff`, `git_stage`, `git_unstage`, `git_commit`, and `git_init`. The commit command requires the `indexFingerprint` returned by status as its `expectedIndex` parameter. Native command registration belongs in `src-tauri/src/lib.rs`.
