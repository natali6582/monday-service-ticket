const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function contact(id, email, subscriptionStatus = 'NOT_SET', deliverabilityStatus = 'VALID') {
  return {
    _id: id,
    primaryInfo: { email },
    info: {
      emails: [{ email, primary: true }],
      extendedFields: {
        'emailSubscriptions.effectiveEmail': email,
        'emailSubscriptions.subscriptionStatus': subscriptionStatus,
        'emailSubscriptions.deliverabilityStatus': deliverabilityStatus
      }
    }
  };
}

function harness({ triggerContact = contact('trigger-contact', 'client@example.com'), matches = [], resolvedContact, getError, queryError, sendError, alertError } = {}) {
  const calls = { get: [], query: [], email: [], alert: [], mutation: [] };
  const contactsApi = {
    async getContact(id, options) {
      calls.get.push({ id, options });
      if (getError) throw new Error(getError);
      return id === 'trigger-contact' ? triggerContact : resolvedContact || matches.find(item => item._id === id);
    },
    queryContacts() {
      const state = {};
      const builder = {
        eq(field, value) { Object.assign(state, { field, value }); return builder; },
        limit(limit) { state.limit = limit; return builder; },
        async find(options) {
          calls.query.push({ ...state, options });
          if (queryError) throw new Error(queryError);
          return { items: matches };
        }
      };
      return builder;
    }
  };
  for (const method of ['createContact', 'updateContact', 'appendOrCreateContact', 'mergeContacts']) {
    contactsApi[method] = () => {
      calls.mutation.push(method);
      throw new Error('Contact mutations are forbidden');
    };
  }
  const sourcePath = path.resolve(__dirname, '..', 'monday_ticket.js');
  const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace('export const invoke', 'const invoke');
  const context = {
    console: { log() {}, error() {} },
    contacts: contactsApi,
    triggeredEmails: { emailContact: async (...args) => {
      calls.email.push(args);
      if (sendError) throw new Error(sendError);
    } },
    fetch: async () => { throw new Error('Network is forbidden'); },
    getSecret: async () => { throw new Error('Secrets are forbidden'); }
  };
  vm.createContext(context);
  new vm.Script(source + '\nglobalThis.sendReceipt = sendTicketConfirmationEmailSafely;').runInContext(context);
  const send = overrides => context.sendReceipt('test-token', 'ticket-item', {
    contactId: 'trigger-contact',
    customerEmail: 'client@example.com',
    customerName: 'Test Customer',
    ticketNumber: 12345678,
    issueSubject: 'Test issue',
    ...overrides
  }, context.triggeredEmails.emailContact, async (_auth, _query, variables) => {
    calls.alert.push(variables);
    if (alertError) throw new Error(alertError);
    return { create_update: { id: 'alert-id' } };
  }, contactsApi);
  return { calls, send };
}

test('sends the unchanged template and variables only after confirming the submitted address', async () => {
  const h = harness();
  assert.equal((await h.send()).status, 'sent');
  assert.equal(h.calls.get.length, 1);
  assert.equal(h.calls.get[0].options.suppressAuth, true);
  assert.equal(h.calls.email.length, 1);
  assert.equal(h.calls.email[0][0], 'VPeL0Z3');
  assert.equal(h.calls.email[0][1], 'trigger-contact');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.email[0][2].variables)), {
    customerName: 'Test Customer', ticketNumber: '12345678', issueSubject: 'Test issue', SITE_URL: 'https://www.plan-t.org.il/'
  });
  assert.equal(h.calls.query.length, 0);
  assert.equal(h.calls.mutation.length, 0);
});

test('normalizes case and surrounding whitespace when comparing addresses', async () => {
  const h = harness({ triggerContact: contact('trigger-contact', ' Client@Example.COM ') });
  assert.equal((await h.send({ customerEmail: ' CLIENT@example.com ' })).status, 'sent');
  assert.equal(h.calls.query.length, 0);
});

test('uses the canonical returned contact ID after a merge only if its primary email matches', async () => {
  const h = harness({ triggerContact: contact('merged-target', 'client@example.com') });
  assert.equal((await h.send()).status, 'sent');
  assert.equal(h.calls.email[0][1], 'merged-target');
});

test('resolves an exact existing primary email when the form contact primary belongs to someone else', async () => {
  const wrong = contact('trigger-contact', 'other@example.com');
  wrong.info.emails.push({ email: 'client@example.com', primary: false });
  const h = harness({ triggerContact: wrong, matches: [contact('correct-contact', 'client@example.com')] });
  assert.equal((await h.send()).status, 'sent');
  assert.equal(h.calls.email[0][1], 'correct-contact');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.query)), [{ field: 'primaryInfo.email', value: 'client@example.com', limit: 2, options: { suppressAuth: true } }]);
  assert.deepEqual(h.calls.get.map(call => call.id), ['trigger-contact', 'correct-contact']);
  assert.equal(h.calls.mutation.length, 0);
});

test('does not send to a secondary address or create a duplicate when no exact primary exists', async () => {
  const wrong = contact('trigger-contact', 'other@example.com');
  wrong.info.emails.push({ email: 'client@example.com', primary: false });
  const h = harness({ triggerContact: wrong });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 0);
  assert.equal(h.calls.alert.length, 1);
  assert.match(h.calls.alert[0].body, /RECEIPT_RECIPIENT_NOT_FOUND/);
  assert.equal(h.calls.mutation.length, 0);
});

test('never chooses arbitrarily between duplicate primary email contacts', async () => {
  const h = harness({ triggerContact: contact('trigger-contact', 'other@example.com'), matches: [contact('first', 'client@example.com'), contact('second', 'client@example.com')] });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 0);
  assert.match(h.calls.alert[0].body, /RECEIPT_RECIPIENT_AMBIGUOUS/);
});

test('rechecks a query result so a merged or stale contact cannot redirect the receipt', async () => {
  const h = harness({ triggerContact: contact('trigger-contact', 'other@example.com'), matches: [contact('candidate', 'client@example.com')], resolvedContact: contact('merged-elsewhere', 'other@example.com') });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 0);
});

test('rejects conflicting primary and effective addresses', async () => {
  const record = contact('trigger-contact', 'client@example.com');
  record.info.extendedFields['emailSubscriptions.effectiveEmail'] = 'other@example.com';
  const h = harness({ triggerContact: record });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 0);
  assert.equal(h.calls.query.length, 0);
});

test('missing primary email or canonical ID cannot be guessed from other contact fields', async () => {
  for (const field of ['primaryInfo', '_id']) {
    const record = contact('trigger-contact', 'client@example.com');
    delete record[field];
    const h = harness({ triggerContact: record });
    assert.equal((await h.send()).status, 'failed');
    assert.equal(h.calls.email.length, 0);
    assert.equal(h.calls.alert.length, 1);
  }
});

test('a malformed effective address cannot be normalized into the submitted recipient', async () => {
  const record = contact('trigger-contact', 'client@example.com');
  record.info.extendedFields['emailSubscriptions.effectiveEmail'] = 'client @example.com';
  const h = harness({ triggerContact: record });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 0);
});

for (const subscriptionStatus of ['UNSUBSCRIBED']) {
  test(`does not send or search for an alternate contact when subscription is ${subscriptionStatus}`, async () => {
    const record = contact('trigger-contact', 'client@example.com');
    record.info.extendedFields['emailSubscriptions.subscriptionStatus'] = subscriptionStatus;
    const h = harness({ triggerContact: record });
    assert.equal((await h.send()).status, 'failed');
    assert.equal(h.calls.email.length, 0);
    assert.equal(h.calls.query.length, 0);
    assert.equal(h.calls.mutation.length, 0);
    assert.match(h.calls.alert[0].body, /RECEIPT_SUBSCRIPTION_BLOCKED/);
  });
}

test('leaves a pending subscription to provider enforcement without changing it', async () => {
  const h = harness({ triggerContact: contact('trigger-contact', 'client@example.com', 'PENDING'), sendError: 'Provider rejected pending subscription' });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 1);
  assert.equal(h.calls.mutation.length, 0);
});

test('leaves missing subscription and deliverability metadata to the existing email provider', async () => {
  for (const missing of ['status', 'undefined', 'extendedFields']) {
    const record = contact('trigger-contact', 'client@example.com');
    if (missing === 'extendedFields') {
      delete record.info.extendedFields;
    } else if (missing === 'undefined') {
      record.info.extendedFields['emailSubscriptions.subscriptionStatus'] = undefined;
      record.info.extendedFields['emailSubscriptions.deliverabilityStatus'] = undefined;
    } else {
      delete record.info.extendedFields['emailSubscriptions.subscriptionStatus'];
      delete record.info.extendedFields['emailSubscriptions.deliverabilityStatus'];
    }
    const h = harness({ triggerContact: record });
    assert.equal((await h.send()).status, 'sent');
    assert.equal(h.calls.email.length, 1);
    assert.equal(h.calls.mutation.length, 0);
  }
});

test('allows the documented NOT_SET and SUBSCRIBED subscription states without updating them', async () => {
  for (const status of ['NOT_SET', 'SUBSCRIBED']) {
    const h = harness({ triggerContact: contact('trigger-contact', 'client@example.com', status, 'NOT_SET') });
    assert.equal((await h.send()).status, 'sent');
    assert.equal(h.calls.mutation.length, 0);
  }
});

for (const status of ['BOUNCED', 'SPAM_COMPLAINT', 'INACTIVE']) {
  test(`preserves provider rejection for a ${status} address without changing its status`, async () => {
    const h = harness({ triggerContact: contact('trigger-contact', 'client@example.com', 'NOT_SET', status), sendError: 'Provider rejected delivery' });
    assert.equal((await h.send()).status, 'failed');
    assert.equal(h.calls.email.length, 1);
    assert.equal(h.calls.mutation.length, 0);
    assert.equal(h.calls.alert.length, 1);
  });
}

test('does not bypass an unsubscribe on the exact alternate contact', async () => {
  const h = harness({ triggerContact: contact('trigger-contact', 'other@example.com'), matches: [contact('correct-contact', 'client@example.com', 'UNSUBSCRIBED')] });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 0);
  assert.equal(h.calls.mutation.length, 0);
});

test('missing or invalid submitted email cannot fall back to the form contact', async () => {
  for (const customerEmail of ['', 'invalid', undefined]) {
    const h = harness();
    assert.equal((await h.send({ customerEmail })).status, 'failed');
    assert.equal(h.calls.email.length, 0);
    assert.equal(h.calls.get.length, 0);
    assert.equal(h.calls.alert.length, 1);
  }
});

test('missing contact ID cannot trigger an unverified send', async () => {
  const h = harness();
  assert.equal((await h.send({ contactId: '' })).status, 'failed');
  assert.equal(h.calls.email.length, 0);
});

test('lookup failures preserve the ticket and produce a review alert without sending', async () => {
  for (const options of [{ getError: 'Unavailable' }, { triggerContact: contact('trigger-contact', 'other@example.com'), queryError: 'Unavailable' }]) {
    const h = harness(options);
    assert.equal((await h.send()).status, 'failed');
    assert.equal(h.calls.email.length, 0);
    assert.equal(h.calls.alert.length, 1);
  }
});

test('send rejection and a failing Monday alert do not throw or resend', async () => {
  const h = harness({ sendError: 'Unavailable', alertError: 'Unavailable' });
  assert.equal((await h.send()).status, 'failed');
  assert.equal(h.calls.email.length, 1);
  assert.equal(h.calls.alert.length, 1);
});
