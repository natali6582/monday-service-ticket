# Monday Service Ticket Wix Automation

This repository stores the Wix Velo automation code used to create service-ticket items in Monday.com from a Wix form submission.

## Files

- `monday_ticket.js` - current Wix automation action code.
- `support_page.js` - Wix Velo page code for `/support`: topic tree, progressive
  disclosure, real-time validation, confirmation state.
- `backend/support.jsw` - backend web module that hands the submission to Wix
  Forms so the existing automation keeps firing. Needs the form id and field
  keys filled in from the editor.
- `email_in_progress.html` - the "הקריאה בטיפול" monday automation email.
- `reference/support_form_reference.html` - working reference implementation of
  the target screen. Design and behaviour source of truth for the editor work.
- `docs/wix_editor_instructions.md` - step-by-step editor and monday.com
  instructions, verification checklist, and the "found, not fixed" list.
- `backups/` - timestamped snapshots from the debugging and rollout process.

## Runtime Contract

The code runs inside a Wix Automations "Run Velo code" action.

Required Wix secret:

- `MONDAY_API_KEY` - Monday API token, stored only in Wix Secrets Manager.

Do not hard-code the Monday API token in this repository or in Wix frontend code.

## Monday Target

- Board ID: `5099744321`
- Group ID: `group_mm4zp44x`
- Group name: `Client Requests`

## Ticket Numbers

Before creating a service ticket, the action reads the existing values in the
Monday `Request Number` column across every result page. It generates an
eight-digit number between `10000000` and `99999999` and retries if that number
already exists. The selected value is written to Monday as part of the original
`create_item` mutation and the same value is sent to the customer and support
emails.

If a unique number cannot be selected after 100 attempts, the action stops before
creating an item or sending an email. The number is a customer-facing reference,
not an authentication credential.

## Email Notifications

After Monday creates the service-ticket item, the action starts two Wix email
paths with the same ticket number:

- Customer confirmation triggered-email template: `VPeL0Z3`, sent to the form
  contact ID.
- Support notification custom automation: trigger
  `f6af7c3c-a858-4b7c-97a0-8e4ea8db3206`. The Wix automation owns the internal
  recipient and email layout; the Velo action supplies the ticket and form data.

If either email path fails, the ticket remains created and an explanatory update
is added to the Monday item for manual handling. The Velo code does not use a
fallback mailbox.

## Customer Linking

After the existing ticket-number and email-automation steps finish, the Wix action
tries to connect the new service ticket to a customer in `USERS - מנויים PLAN T`.

- Customer board ID: `1988799742`
- Customer email column: `contact_email`
- Customer phone column: `contact_phone`
- Service-ticket relation column: `board_relation_mm5ajg15` (`לקוח מקושר`)

Email values are compared case-insensitively and phone values are normalized to an
Israeli international format. A unique email or phone match is linked automatically.
If both identifiers match, they must identify the same customer. Conflicting,
duplicated, missing, or unmatched identifiers are not linked automatically; the
action adds an explanatory update to the service-ticket item for manual handling.
Technical customer-linking failures are caught so they do not undo the already-created
ticket or interrupt the existing email step.

## Topic Tree

The form classifies each ticket with a two-level tree plus a conditional
follow-up field, per developer field spec v1.2 section 03. Values are written to
Monday by dropdown label id rather than by string, so renaming a label on the
board cannot silently drop the value.

- `נושא` - `dropdown_mm5qsryr` (10 labels)
- `תת-נושא` - `dropdown_mm5q7p43` (28 labels)
- `פירוט נושא` - `dropdown_mm5q9dm4` (12 labels)
- `מקור` - `text_mm5qwrmt`, constant `support page`

The action accepts both the spec v1.2 field labels and the labels the live form
sends today, so labels can be renamed in the editor without a breaking window.
The legacy free-text topic column is still written alongside the dropdown so
existing board views and automations are unaffected.

Item name follows spec v1.2 section 04: topic, subtopic and office joined with a
middle dot, falling back to the previous single-value behaviour when those
fields are absent.

## Tests

Run the behavior tests with:

```powershell
node --test tests/test_ticket_number.cjs tests/test_customer_linking.cjs tests/test_topic_tree.cjs
```

Or run everything:

```powershell
node --test tests/*.cjs
```

## Notes

The current version normalizes Israeli phone numbers before sending them to Monday, validates email values before setting the Monday email column, strips a leading `Bearer` prefix from the Wix secret value if present, accepts Wix form labels with trailing colons, assigns a collision-checked eight-digit ticket number, sends customer and support notifications with that same number, and then attempts safe customer linking.
