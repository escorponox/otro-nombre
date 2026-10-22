# PR Master

A Claude Code mod that shows your pull requests, the ones your teams must review and the ones you merged, from opening to production, and tells you whose **Turn** it is on each. You can act on them, or ask Claude to analyse them, without leaving the session.

## Requirements

- Claude Code in a terminal session (the install command is not available in the desktop app's Code tab; once installed at user scope, the mod loads there too).
- A GitHub token, either:
  - the GitHub CLI logged in (`gh auth login`); the mod runs `gh auth token`, or
  - a token in the mod's **GitHub token** setting, used only when `gh auth token` gives none. It needs the `repo` and `read:org` scopes.
- macOS, to open pull requests in the browser (the mod runs `open <url>`).

## Installation

At the prompt of a Claude Code terminal session, type:

```
/plugin install pr-master --marketplace escorponox/pr-master-mod
```

Then:

1. Answer `y` to add the `github:escorponox/pr-master-mod` marketplace.
2. Choose a scope; the user scope, first in the list, loads the mod in every session.
3. Set the options (see [Settings](#settings)) or keep the defaults.

Claude Code answers `Installed pr-master. Plugin is now active.` and the mod runs in that session straight away.

To get a newer version later:

```
claude plugin update pr-master@pr-master-mod
```

then run `/reload-plugins` in an open session, or start a new one.

## Usage

### The panel

`/prs` opens the PR panel, or closes it when it is open. With the panel closed, the status line still sums up what waits on you, for example `● 1 ready · 2 need you · 3 to review`.

The panel has three tabs:

| Tab | Key | What it lists |
| --- | --- | --- |
| Mine | `1` | Your open pull requests, with their Readiness, from Draft to Ready to merge |
| Review | `2` | Open, non-draft pull requests by others where one of your teams is asked to review and you have not reviewed yet. Team switches under the tabs show or hide each team's requests |
| Merged | `3` | Your pull requests merged within the merged window, followed through CI, release, staging and production |

Other keys in the panel:

- `r` refreshes now. The panel refreshes by itself every minute while open, and every five minutes while closed.
- `l` shows or hides the legend of colours.

Each pull request carries a coloured dot for its **Turn**: **Mine** (you act next), **Theirs** (CI, reviewers or the author), **Done** (nothing left to do) or **Parked** (a draft).

### Alerts

While the session is open, a toast tells you when one of your pull requests:

- needs you: its **Turn** became **Mine**, a new Review request included;
- became Ready to merge;
- reached production;
- failed CI after merging.

Each toast says the pull request's number, its repository and what it became, for example `#123 api · Changes requested`, and stays ten seconds. More than three at once come as one toast, for example `5 Alerts · /prs`. Clicking a toast only closes it: open `/prs` to act on the pull request.

The first time a session shows your pull requests it raises none for what already waits; from then on it raises one for each change, those since your sessions last fetched included. Every open session raises its own.

### Actions

Move the focus to a pull request with Tab, the arrow keys or a click. The focused pull request's actions get hotkeys:

| Action | Key | Where |
| --- | --- | --- |
| Copy link | `c` | Every tab |
| Squash merge | `m` | Mine, when Ready to merge |
| Update branch | `u` | Mine, when the branch is behind its base |
| Close | `x` | Mine |
| Approve | `p` | Review |
| Unblock analysis | `n` | Mine |
| Review analysis | `n` | Review |

Pressing the pull request's number opens it in the browser.

Merge, update, close and approve write to GitHub, so each asks for confirmation: the first press arms the button, and a second press within three seconds runs it.

### Analyses

An analysis runs Claude in the background, with read-only tools, on one pull request:

- **Review analysis** (Review tab): what the change does, its risks and what to look at.
- **Unblock analysis** (Mine tab): why the pull request is not ready to merge and how to fix it.

The result shows under the pull request and is kept for that commit. It stays out of the conversation: the subagent's report, which Claude Code would hand to the session, is dropped, leaving one line that says the analysis is in the panel. **Continue in conversation** sends it to the session as a prompt, so you can carry on from it with Claude.

### Shipment of merged pull requests

The Merged tab follows each pull request through CI, its release, staging and production. Staging and production come from the `stableVersion` that Kargo commits into the organisation's deployments repository, read through the GitHub API. They show only for repositories that publish GitHub Releases, declare their image as `repository:` in `.circleci/config.yml` and have a deployments repository in the same organisation with a `kargo/` folder; other repositories show CI and release alone. The token must be able to read the deployments repository and use code search.

## Settings

Set them on install, or later with `claude plugin configure pr-master@pr-master-mod`, which also shows the ones left unset.

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| Stale threshold | `off`, `2w`, `1m`, `3m`, `6m` | `1m` | Marks pull requests older than this as stale |
| Review window | `off`, `1w`, `2w`, `1m` | `2w` | Lists Review requests opened within this window |
| Merged window | `off`, `1d`, `3d`, `1w` | `3d` | Lists your pull requests merged within this window in the Merged tab |
| Hidden organisations | logins | none | Organisations or users whose pull requests the panel never shows |
| Show private repositories | yes / no | yes | Shows pull requests in private repositories |
| Alerts | yes / no | yes | Raises a toast when a pull request needs you, becomes Ready to merge, reaches production or fails CI after merging |
| GitHub token | token | none | Used only when `gh auth token` gives none |

## Development

Run a session with the mod loaded from this working copy; saving a file reloads it:

```
claude --plugin-dir ./pr-master
```

Check and test it:

```
claude plugin validate .
claude plugin test ./pr-master
```

Domain terms are defined in [GLOSSARY.md](GLOSSARY.md).
