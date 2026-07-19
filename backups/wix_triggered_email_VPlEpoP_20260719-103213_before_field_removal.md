# Wix triggered email rollback snapshot

- Email ID: `VPlEpoP`
- Status before edit: Published
- Editor URL: `https://manage.wix.com/dashboard/6c7e4328-4c4d-4c2c-b55c-96e275b62cb3/developer-tools/triggered-emails/edit/4b393aa9-168b-44da-ba7c-991187fc66fc`
- Scope: Internal service email only. Customer email `VPeL0Z3` must not be changed.

## Subject

`פנייה מספר ${ticketNumber} – ${issueSubject}`

## Preview

`מספר הפנייה: ${ticketNumber}`

## Body before edit

1. `פנייה חדשה התקבלה`
2. `מספר הפנייה: ${ticketNumber}`
3. `שם הלקוח: ${customerName}`
4. `אימייל: ${customerEmail}`
5. `טלפון: ${customerPhone}`
6. `שם המשרד: ${officeName}`
7. `דחיפות: ${urgency}`
8. `נושא הפנייה: ${issueSubject}`
9. `פירוט הפנייה:`
10. `${issueDetails}`
11. `עמוד באתר: ${pageUrl}`
12. `הפנייה נוצרה ב-Monday והועברה לטיפול.`

## Approved edit

- Replace line 3 with `${customerName}` so only the label `שם הלקוח:` is removed.
- Delete line 7 entirely.
- Delete line 12 entirely.

## Rollback

Restore the three lines from the body snapshot above and republish email ID `VPlEpoP`.
