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

## Notes

The current version normalizes Israeli phone numbers before sending them to Monday, validates email values before setting the Monday email column, strips a leading `Bearer` prefix from the Wix secret value if present, and accepts Wix form labels with trailing colons.
