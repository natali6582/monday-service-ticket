# Wix Support Email Deployment Rollback

Captured: 2026-07-19 00:28:59 Asia/Jerusalem

## Target

- Wix site ID: `6c7e4328-4c4d-4c2c-b55c-96e275b62cb3`
- Automation: `טופס תמיכה טכנית -Monday`
- Pre-deployment status: `ACTIVE`

## Verified Pre-deployment Workflow

1. `Send an email` - active; subject `התקבל טופס חדש:${formName}`.
2. `Create Technical Support Item in Monday.com` - active Velo action using the
   pre-support code snapshot below.
3. `Send an email (1)` - already marked `skipped`; leave unchanged.

Do not modify the separate inactive automation named `שליחת מיילי פנייה עם מספר`.

## Snapshots

- Production rollback code:
  `wix_production_20260719-002859_before_support_deploy.js`
  - SHA-256: `E05E9DDA90CE9A92312136675F20E464BC13F1FC336FCFA225D33DD4BDAA9BBE`
- Release candidate code:
  `wix_release_candidate_20260719-002859.js`
  - SHA-256: `AECCA5DF159E68F50D2C099CDB908E294C941F3B9634460E0632F05B72FF1FC5`

## New Support Path

- Triggered email ID: `VPlEpoP`
- Subject: `פנייה מספר ${ticketNumber} – ${issueSubject}`
- Recipient lookup: unique Wix contact whose primary email is
  `supportclient@plan-t.org.il`
- Verified contact ID: `4c754848-8b2d-45e5-88e9-5fb3326a32ee`

## Rollback Procedure

1. Open the active `טופס תמיכה טכנית -Monday` automation in Wix.
2. If the original `Send an email` action is marked `skipped`, unskip it.
3. Replace the Velo action code with the complete contents of
   `wix_production_20260719-002859_before_support_deploy.js`.
4. Apply the action, save the automation, and publish the changes.
5. Verify that the automation is `ACTIVE`, the original email action is active,
   and `Send an email (1)` remains skipped.

The `VPlEpoP` template can remain published after rollback because the restored
code does not call it. Do not delete test tickets automatically; keep them as
deployment evidence unless deletion is separately approved.
