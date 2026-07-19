# Wix automation rollback record

- Site ID: `6c7e4328-4c4d-4c2c-b55c-96e275b62cb3`
- Automation name: `שליחת מיילי פנייה עם מספר`
- Automation ID: `f5eb6a81-f1a2-4e4b-a988-489f86244609`
- Velo trigger ID: `f6af7c3c-a858-4b7c-97a0-8e4ea8db3206`
- Status before this change: `INACTIVE`
- Existing state: unpublished changes were already present before this task

## Existing trigger payload schema

```json
{
  "submissionTime": "2026-07-15T12:00:00Z",
  "ticketNumber": 1234567890,
  "customerName": "בדיקה",
  "pageUrl": "https://www.plan-t.org.il/support",
  "officeName": "Plan-T",
  "urgency": "Medium",
  "issueDetails": "בדיקה",
  "contactId": "807a6ffb-2a85-4a0e-8dee-45195a759372",
  "customerEmail": "customer@example.com",
  "wixSubmissionId": "edca2245-7ce3-4d95-bfe9-b2012110eb8f",
  "phone": "0546462464",
  "issueSubject": "טעינת קבצים"
}
```

## Existing draft email action before this task

- Sender name: `sales`
- Reply-to: `supportclient@plan-t.org.il`
- Subject: `פנייתך התקבלה – מספר ${ticketNumber}`
- Preview: `פנייתך התקבלה בצוות Plan-T`
- Body purpose: customer confirmation
- Dynamic reply-to: disabled
- Separate email conversations: disabled

## Production rollback

The production form automation `טופס תמיכה טכנית -Monday` remains active while this parallel automation is configured and tested.

To roll back after activation:

1. Deactivate automation `f5eb6a81-f1a2-4e4b-a988-489f86244609`.
2. Restore `monday_ticket.js` from `monday_ticket_20260719-095627_before_dynamic_reply_to.js`.
3. Restore the same code in the Wix automation action and activate the original production automation.
4. Do not change customer triggered email template `VPeL0Z3`.
