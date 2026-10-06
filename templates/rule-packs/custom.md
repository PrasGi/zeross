<!--
zeross template: custom.md

Holds this team's own free-text rules, captured in the /zeross install interview
(batch B, "custom rules"), e.g. "no `any`", "every new component gets a story",
"API errors use the `AppError` class".

Placeholders filled by the installer:
  {{customRules}}  The rules as Markdown bullets, one rule per bullet, in imperative
                   mood. If the user gave none, the installer writes
                   "- _No custom rules yet._"

Precedence: these rules override every other pack in .claude/rules/zeross/.
Maintenance: add rules with /zero-learn (it checks for duplicates and conflicts and
asks before writing), or edit this file by hand and commit it. English only.
Never put secrets, tokens, hostnames of private systems or passwords here.
-->
# Custom team rules

Applies to: every app in this project. These rules override the other packs.

{{customRules}}
