# Form rules

Applies to: every form and input flow in frontend apps.

> Strictness follows `rules.strictness`; tests follow `rules.testPolicy`.

## Validation

- **One schema, shared with the backend** when possible: a shared package, a generated schema, or the same zod, valibot or yup schema imported by both. Otherwise mirror the backend's rules exactly and say so.
- Use the project's form library (React Hook Form, Formik, TanStack Form, VeeValidate, FormKit) with its schema resolver. Don't hand-roll validation state for non-trivial forms.
- Client validation is UX. **The server always validates again** and is the authority.
- Map server validation errors (422/400 with field details) back onto their fields. Show non-field errors in a form-level message.
- Normalize input before validating: trim strings, and parse numbers and dates with locale awareness. Never send the formatted display value to the API.

## UX

- Every input has a visible `<label>` (or `aria-label` when the design truly has no label) and the correct `type`, `autocomplete` and `inputmode`.
- Show errors inline, next to the field. Link them with `aria-describedby` and set `aria-invalid`. On submit, move focus to the first invalid field.
- Validate on blur or submit first, then live while correcting. Don't show errors before the user has interacted.
- Required and optional fields are marked consistently with neighboring forms.
- Preserve user input on server errors. Never clear the form on failure.

## Submission

- Disable submit and show a pending state while submitting. **Prevent double submit**: use the pending flag plus an idempotency key when the API supports one.
- Handle every outcome: success (with feedback and navigation or reset as designed), validation error, auth expired, network failure (with retry), and conflict (409).
- Optimistic updates only when the project already uses them for similar actions, with a rollback on error.
- Never put secrets or sensitive data in query strings or `GET` forms.

## Unsaved changes and destructive actions

- Leaving a dirty form, and delete, reset or overwrite actions, follow "Destructive actions" in `core.md`.

## Specific inputs

- Money: integer minor units or a decimal string. Never floating-point math. Format with the locale.
- Dates: be explicit about time zones. Send ISO 8601 and show local time per the project's convention.
- Files: check type and size on the client for UX, show progress and errors, and rely on server checks for security.
- Passwords: never pre-fill or log them. Allow paste. Use `autocomplete="current-password"` or `"new-password"`.
- Phone, email and URLs: validate the format in the schema, and store them normalized.

## Testing

- Test the schema directly: valid, each invalid rule, and boundaries (min/max length, ranges).
- Component tests:
  - fill fields with `userEvent`, submit, and assert the inline errors and the API payload
  - server error mapping onto fields
  - pending and disabled state
  - no double submit
