# Monday Service Ticket Wix Automation

This repository stores the Wix Velo automation code used to create service-ticket items in Monday.com from a Wix form submission.

## Files

- `monday_ticket.js` - current Wix automation action code.
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
`create_item` mutation and the same value is sent to the customer email.

If a unique number cannot be selected after 100 attempts, the action stops before
creating an item or sending an email. The number is a customer-facing reference,
not an authentication credential.

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

## Tests

Run the behavior tests with:

```powershell
node --test tests/test_ticket_number.cjs tests/test_customer_linking.cjs
```

## Notes

The current version normalizes Israeli phone numbers before sending them to Monday, validates email values before setting the Monday email column, strips a leading `Bearer` prefix from the Wix secret value if present, accepts Wix form labels with trailing colons, assigns a collision-checked eight-digit ticket number, queues the existing Wix email automation, and then attempts safe customer linking.
