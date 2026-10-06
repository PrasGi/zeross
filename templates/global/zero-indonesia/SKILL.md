---
name: zero-indonesia
description: Switch this session's conversation language to Bahasa Indonesia. Code, comments, docs, commits, PR descriptions and file content stay in English.
argument-hint: ""
disable-model-invocation: true
---

# /zero-indonesia

Switch this session's conversation language to Bahasa Indonesia.

## Scope

- Applies **only** to conversational text: explanations, questions
  (including `AskUserQuestion` text), status updates, reports and summaries.
- Stays in English — never translate:
  - code, code comments and docstrings
  - docs and any file content written to disk
  - commit messages, PR titles and descriptions, ticket comments
  - technical identifiers: function names, file paths, library names, CLI commands
- Applies to the current session only. Do not edit `CLAUDE.md`, settings,
  `profile.json` or any other config to make it permanent — this command is the
  override mechanism itself.

## Behavior

From now on in this conversation, respond in Bahasa Indonesia for all conversational
output. Every other rule stays unchanged (output style, git, security, zeross
workflow) — only the conversation language changes.

If the user writes in English again, keep responding in Indonesian until they
explicitly ask to switch back (e.g. "pakai english lagi", "switch to English",
`/english`).

Confirm the switch with one short line in Indonesian.
