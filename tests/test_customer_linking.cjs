const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE_PATH = path.resolve(__dirname, '..', 'monday_ticket.js');

function loadCustomerLinkingCode() {
  let source = fs.readFileSync(SOURCE_PATH, 'utf8');
  source = source
    .replace(/^import .*;\s*$/gm, '')
    .replace('export const invoke', 'const invoke');
  source += `
    globalThis.__customerLinking = {
      resolveCustomerMatch,
      linkCustomerToTicket,
      linkCustomerToTicketSafely,
      sendTicketConfirmationEmailSafely
    };
  `;

  const context = {
    console: { log() {}, error() {} },
    fetch: async () => { throw new Error('Unexpected fetch call'); },
    getSecret: async () => 'test-token',
    triggeredEmails: { emailContact: async () => {} },
    customTrigger: { runTrigger: async () => {} },
    auth: { elevate: (fn) => fn }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: SOURCE_PATH }).runInContext(context);
  return context.__customerLinking;
}

function customer(id, email, phone) {
  return {
    id: String(id),
    name: `Customer ${id}`,
    column_values: [
      { id: 'contact_email', text: email || '' },
      { id: 'contact_phone', text: phone || '' }
    ]
  };
}

function onePage(items, cursor = null) {
  return { boards: [{ items_page: { cursor, items } }] };
}

const {
  resolveCustomerMatch,
  linkCustomerToTicket,
  linkCustomerToTicketSafely,
  sendTicketConfirmationEmailSafely
} = loadCustomerLinkingCode();

test('sends the published Wix email with the provided ticket number and customer fields', async () => {
  const emailCalls = [];
  const emailContact = async (...args) => emailCalls.push(args);

  const result = await sendTicketConfirmationEmailSafely(
    'token',
    '9000',
    {
      contactId: 'contact-123',
      customerName: 'Dana',
      ticketNumber: 15567173,
      issueSubject: 'Password reset'
    },
    emailContact
  );

  assert.equal(result.status, 'sent');
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0][0], 'VPeL0Z3');
  assert.equal(emailCalls[0][1], 'contact-123');
  assert.deepEqual(JSON.parse(JSON.stringify(emailCalls[0][2].variables)), {
    customerName: 'Dana',
    ticketNumber: '15567173',
    issueSubject: 'Password reset',
    SITE_URL: 'https://www.plan-t.org.il/'
  });
});

test('keeps the ticket flow alive and adds a Monday update when email delivery fails', async () => {
  const requestCalls = [];
  const request = async (_authorization, _query, variables, operationName) => {
    requestCalls.push({ variables, operationName });
    return { create_update: { id: 'update-email-failure' } };
  };
  const failedEmailContact = async () => {
    throw new Error('Temporary Wix email failure');
  };

  const result = await sendTicketConfirmationEmailSafely(
    'token',
    '9005',
    {
      contactId: 'contact-456',
      customerName: 'Dana',
      ticketNumber: 9005,
      issueSubject: 'Password reset'
    },
    failedEmailContact,
    request
  );

  assert.equal(result.status, 'failed');
  assert.equal(requestCalls.length, 1);
  assert.equal(requestCalls[0].operationName, 'create_customer_link_alert');
  assert.equal(requestCalls[0].variables.itemId, '9005');
  assert.match(requestCalls[0].variables.body, /email was not sent automatically/);
});

test('matches a single customer by normalized email', () => {
  const result = resolveCustomerMatch([
    customer(101, ' Client@Example.COM ', ''),
    customer(102, 'other@example.com', '')
  ], 'client@example.com', '');

  assert.equal(result.status, 'matched');
  assert.equal(result.customerId, '101');
  assert.equal(result.matchedBy, 'email');
});

test('falls back to a normalized Israeli phone number', () => {
  const result = resolveCustomerMatch([
    customer(201, '', '052-123-4567')
  ], '', '+972521234567');

  assert.equal(result.status, 'matched');
  assert.equal(result.customerId, '201');
  assert.equal(result.matchedBy, 'phone');
});

test('does not link when email and phone identify different customers', () => {
  const result = resolveCustomerMatch([
    customer(301, 'client@example.com', '0500000001'),
    customer(302, 'other@example.com', '0521234567')
  ], 'client@example.com', '+972521234567');

  assert.equal(result.status, 'conflict');
  assert.equal(result.customerId, undefined);
});

test('does not link a duplicated email without another unique identifier', () => {
  const result = resolveCustomerMatch([
    customer(401, 'shared@example.com', ''),
    customer(402, 'shared@example.com', '')
  ], 'shared@example.com', '');

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.customerId, undefined);
});

test('uses the unique intersection when a duplicated email is narrowed by phone', () => {
  const result = resolveCustomerMatch([
    customer(501, 'shared@example.com', '0500000001'),
    customer(502, 'shared@example.com', '0521234567')
  ], 'shared@example.com', '+972521234567');

  assert.equal(result.status, 'matched');
  assert.equal(result.customerId, '502');
  assert.equal(result.matchedBy, 'email_and_phone');
});

test('links the created ticket through the verified board relation column', async () => {
  const calls = [];
  const request = async (_authorization, _query, variables, operationName) => {
    calls.push({ variables, operationName });
    if (operationName === 'get_customer_items') {
      return onePage([customer(601, 'client@example.com', '0521234567')]);
    }
    if (operationName === 'link_customer_item') {
      return { change_multiple_column_values: { id: variables.itemId } };
    }
    throw new Error(`Unexpected operation: ${operationName}`);
  };

  const result = await linkCustomerToTicket(
    'token',
    '9001',
    'client@example.com',
    '+972521234567',
    request
  );

  assert.equal(result.status, 'matched');
  assert.deepEqual(calls.map((call) => call.operationName), [
    'get_customer_items',
    'link_customer_item'
  ]);
  const relationValue = JSON.parse(calls[1].variables.columnValues);
  assert.deepEqual(relationValue, {
    board_relation_mm5ajg15: { item_ids: [601] }
  });
});

test('paginates customer items before deciding that a phone matches', async () => {
  const calls = [];
  const request = async (_authorization, _query, variables, operationName) => {
    calls.push({ variables, operationName });
    if (operationName === 'get_customer_items') {
      return onePage([customer(701, 'first@example.com', '')], 'next-cursor');
    }
    if (operationName === 'get_next_customer_items') {
      return {
        next_items_page: {
          cursor: null,
          items: [customer(702, '', '0521234567')]
        }
      };
    }
    if (operationName === 'link_customer_item') {
      return { change_multiple_column_values: { id: variables.itemId } };
    }
    throw new Error(`Unexpected operation: ${operationName}`);
  };

  const result = await linkCustomerToTicket(
    'token',
    '9002',
    '',
    '+972521234567',
    request
  );

  assert.equal(result.customerId, '702');
  assert.deepEqual(calls.map((call) => call.operationName), [
    'get_customer_items',
    'get_next_customer_items',
    'link_customer_item'
  ]);
  assert.equal(calls[1].variables.cursor, 'next-cursor');
});

test('adds an item update when no customer is found', async () => {
  const calls = [];
  const request = async (_authorization, _query, variables, operationName) => {
    calls.push({ variables, operationName });
    if (operationName === 'get_customer_items') {
      return onePage([]);
    }
    if (operationName === 'create_customer_link_alert') {
      return { create_update: { id: 'update-1' } };
    }
    throw new Error(`Unexpected operation: ${operationName}`);
  };

  const result = await linkCustomerToTicket(
    'token',
    '9003',
    'missing@example.com',
    '+972521234567',
    request
  );

  assert.equal(result.status, 'not_found');
  assert.deepEqual(calls.map((call) => call.operationName), [
    'get_customer_items',
    'create_customer_link_alert'
  ]);
  assert.match(calls[1].variables.body, /לא נמצא לקוח תואם/);
});

test('a lookup failure never breaks the existing ticket flow and creates a technical alert', async () => {
  const calls = [];
  const request = async (_authorization, _query, variables, operationName) => {
    calls.push({ variables, operationName });
    if (operationName === 'get_customer_items') {
      throw new Error('Temporary Monday lookup failure');
    }
    if (operationName === 'create_customer_link_alert') {
      return { create_update: { id: 'update-2' } };
    }
    throw new Error(`Unexpected operation: ${operationName}`);
  };

  const result = await linkCustomerToTicketSafely(
    'token',
    '9004',
    'client@example.com',
    '+972521234567',
    request
  );

  assert.equal(result.status, 'technical_error');
  assert.deepEqual(calls.map((call) => call.operationName), [
    'get_customer_items',
    'create_customer_link_alert'
  ]);
  assert.match(calls[1].variables.body, /הקישור האוטומטי נכשל טכנית/);
});
