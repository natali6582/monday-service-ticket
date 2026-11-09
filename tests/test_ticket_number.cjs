const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE_PATH = path.resolve(__dirname, '..', 'monday_ticket.js');
const TICKET_NUMBER_COLUMN_ID = 'numeric_mm59qx9e';
const SUPPORT_EMAIL = 'supportclient@plan-t.org.il';
const CUSTOMER_TRIGGERED_EMAIL_ID = 'VPeL0Z3';
const SUPPORT_TRIGGERED_EMAIL_ID = 'VPlEpoP';
const SUPPORT_CONTACT_ID = 'support-contact-456';
const WIX_AUTOMATION_ACTION_MODULES = [
  'wix-fetch',
  'wix-secrets-backend',
  'wix-crm-backend'
];

function mondayResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data })
  };
}

function randomForTicketNumber(ticketNumber) {
  return (ticketNumber - 10_000_000 + 0.5) / 90_000_000;
}

function loadAutomation({
  ticketNumberPages = [[]],
  randomValues = [0],
  supportContacts = [{ _id: SUPPORT_CONTACT_ID }],
  availableWixModules = null
} = {}) {
  let source = fs.readFileSync(SOURCE_PATH, 'utf8');
  if (availableWixModules) {
    const availableModuleNames = new Set(availableWixModules);
    source = source.replace(
      /^import\s+\{([^}]+)\}\s+from\s+'([^']+)';\s*$/gm,
      (_statement, bindings, moduleName) => {
        if (!availableModuleNames.has(moduleName)) {
          throw new Error(`Wix automation action module is unavailable: ${moduleName}`);
        }
        return `const { ${bindings.trim()} } = __wixModules[${JSON.stringify(moduleName)}];`;
      }
    );
  } else {
    source = source.replace(/^import .*;\s*$/gm, '');
  }
  source = source.replace('export const invoke', 'const invoke');
  source += `
    globalThis.__ticketAutomation = { invoke };
  `;

  const createCalls = [];
  const emailCalls = [];
  const supportTriggerCalls = [];
  const operationCalls = [];
  const alertBodies = [];
  const contactQueryCalls = [];
  let nextTicketNumberPage = 1;
  let randomIndex = 0;

  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const query = request.query;
    const variables = request.variables;

    if (query.includes('GetTicketNumbers')) {
      operationCalls.push('get_ticket_numbers');
      return mondayResponse({
        boards: [{
          items_page: {
            cursor: ticketNumberPages.length > 1 ? 'ticket-page-2' : null,
            items: ticketItems(ticketNumberPages[0] || [])
          }
        }]
      });
    }

    if (query.includes('GetNextTicketNumbers')) {
      operationCalls.push('get_next_ticket_numbers');
      const page = ticketNumberPages[nextTicketNumberPage] || [];
      nextTicketNumberPage += 1;
      return mondayResponse({
        next_items_page: {
          cursor: nextTicketNumberPage < ticketNumberPages.length
            ? `ticket-page-${nextTicketNumberPage + 1}`
            : null,
          items: ticketItems(page)
        }
      });
    }

    if (query.includes('CreateServiceTicket')) {
      operationCalls.push('create_item');
      createCalls.push(variables);
      return mondayResponse({ create_item: { id: '3091574540', name: variables.itemName } });
    }

    if (query.includes('SetTicketNumber')) {
      operationCalls.push('set_ticket_number');
      return mondayResponse({ change_simple_column_value: { id: variables.itemId } });
    }

    if (query.includes('GetCustomerItems')) {
      operationCalls.push('get_customer_items');
      return mondayResponse({
        boards: [{ items_page: { cursor: null, items: [] } }]
      });
    }

    if (query.includes('CreateCustomerLinkAlert')) {
      operationCalls.push('create_customer_link_alert');
      alertBodies.push(variables.body);
      return mondayResponse({ create_update: { id: 'update-1' } });
    }

    throw new Error(`Unexpected Monday query: ${query}`);
  };

  const math = Object.create(Math);
  math.random = () => {
    const value = randomValues[Math.min(randomIndex, randomValues.length - 1)];
    randomIndex += 1;
    return value;
  };

  const contacts = {
    getContact: async (_id) => ({
      _id,
      primaryInfo: { email: 'dana@example.com' },
      info: { extendedFields: { 'emailSubscriptions.subscriptionStatus': 'NOT_SET' } }
    }),
    queryContacts: () => {
      const query = {
        eq: (...args) => {
          contactQueryCalls.push(['eq', ...args]);
          return query;
        },
        limit: (...args) => {
          contactQueryCalls.push(['limit', ...args]);
          return query;
        },
        find: async (...args) => {
          contactQueryCalls.push(['find', ...args]);
          return { items: [{ _id: SUPPORT_CONTACT_ID }] };
        }
      };
      return query;
    }
  };

  const context = {
    console: { log() {}, error() {} },
    fetch,
    getSecret: async () => 'test-token',
    contacts: {
      getContact: contacts.getContact,
      queryContacts() {
        const queryState = {};
        const builder = {
          eq(field, value) {
            queryState.field = field;
            queryState.value = value;
            return builder;
          },
          limit(value) {
            queryState.limit = value;
            return builder;
          },
          async find(options) {
            contactQueryCalls.push({ ...queryState, options });
            return { items: supportContacts };
          }
        };
        return builder;
      }
    },
    triggeredEmails: {
      emailContact: async (...args) => emailCalls.push(args)
    },
    Math: math
  };
  context.__wixModules = {
    'wix-fetch': { fetch },
    'wix-secrets-backend': { getSecret: context.getSecret },
    'wix-crm-backend': { contacts, triggeredEmails: context.triggeredEmails }
  };
  vm.createContext(context);
  new vm.Script(source, { filename: SOURCE_PATH }).runInContext(context);

  return {
    invoke: context.__ticketAutomation.invoke,
    createCalls,
    emailCalls,
    supportTriggerCalls,
    operationCalls,
    alertBodies,
    contactQueryCalls
  };
}

function ticketItems(ticketNumbers) {
  return ticketNumbers.map((ticketNumber, index) => ({
    id: String(1000 + index),
    column_values: [{
      id: TICKET_NUMBER_COLUMN_ID,
      text: String(ticketNumber)
    }]
  }));
}

function formPayload() {
  return {
    contactId: 'contact-123',
    submissionId: 'submission-789',
    submissionTime: '2026-07-19T08:15:00.000Z',
    submissions: [
      { label: 'Full Name', value: 'Dana' },
      { label: 'Email', value: 'dana@example.com' },
      { label: 'Phone', value: '052-123-4567' },
      { label: 'Office Name', value: 'Dana Finance' },
      { label: 'Urgency', value: 'High' },
      { label: 'Issue Subject', value: 'Password reset' },
      { label: 'Issue Details', value: 'The reset link is expired.' },
      { label: 'Page URL', value: 'https://www.plan-t.org.il/support' }
    ]
  };
}

test('loads with only the modules available to a Wix automation action', () => {
  assert.doesNotThrow(() => loadAutomation({
    availableWixModules: WIX_AUTOMATION_ACTION_MODULES
  }));
});

test('sends VPlEpoP internally without changing the VPeL0Z3 customer email', async () => {
  const automation = loadAutomation({
    randomValues: [0],
    availableWixModules: [
      ...WIX_AUTOMATION_ACTION_MODULES,
      '@wix/automations',
      '@wix/essentials'
    ]
  });

  await automation.invoke({ payload: formPayload() });

  const customerEmailCall = automation.emailCalls.find(
    (call) => call[0] === CUSTOMER_TRIGGERED_EMAIL_ID
  );
  const supportEmailCall = automation.emailCalls.find(
    (call) => call[0] === SUPPORT_TRIGGERED_EMAIL_ID
  );

  assert.ok(customerEmailCall, 'the customer email must still use VPeL0Z3');
  assert.equal(customerEmailCall[1], 'contact-123');
  assert.equal(customerEmailCall[2].variables.ticketNumber, '10000000');
  assert.ok(supportEmailCall, 'the internal notification must use VPlEpoP');
  assert.equal(supportEmailCall[1], SUPPORT_CONTACT_ID);
  assert.equal(supportEmailCall[2].variables.ticketNumber, '10000000');
  assert.equal(automation.emailCalls.length, 2);
  assert.equal(automation.supportTriggerCalls.length, 0);
});

test('stores and emails the same eight-digit ticket number', async () => {
  const automation = loadAutomation({ randomValues: [0] });

  await automation.invoke({ payload: formPayload() });

  assert.equal(automation.createCalls.length, 1);
  const createdColumns = JSON.parse(automation.createCalls[0].columnValues);
  assert.equal(createdColumns[TICKET_NUMBER_COLUMN_ID], '10000000');
  const customerEmailCall = automation.emailCalls.find((call) => call[0] === 'VPeL0Z3');
  assert.ok(customerEmailCall);
  assert.equal(customerEmailCall[2].variables.ticketNumber, '10000000');
  assert.equal(automation.operationCalls.includes('set_ticket_number'), false);
});

test('sends the same ticket number to the customer and support email templates', async () => {
  const automation = loadAutomation({ randomValues: [0] });

  await automation.invoke({ payload: formPayload() });

  assert.equal(automation.emailCalls.length, 2);
  const customerEmailCall = automation.emailCalls.find((call) => call[0] === 'VPeL0Z3');
  const supportEmailCall = automation.emailCalls.find((call) => call[0] !== 'VPeL0Z3');

  assert.ok(customerEmailCall);
  assert.ok(supportEmailCall);
  assert.equal(supportEmailCall[0], 'VPlEpoP');
  assert.equal(supportEmailCall[1], SUPPORT_CONTACT_ID);
  assert.notEqual(supportEmailCall[1], customerEmailCall[1]);
  assert.equal(customerEmailCall[2].variables.ticketNumber, '10000000');
  assert.equal(supportEmailCall[2].variables.ticketNumber, '10000000');
  assert.equal(supportEmailCall[2].variables.issueSubject, 'Password reset');
  assert.equal(supportEmailCall[2].variables.customerName, 'Dana');
  assert.equal(supportEmailCall[2].variables.customerEmail, 'dana@example.com');
  assert.equal(supportEmailCall[2].variables.urgency, 'High');
  assert.equal(automation.contactQueryCalls.length, 1);
  assert.equal(automation.contactQueryCalls[0].field, 'primaryInfo.email');
  assert.equal(automation.contactQueryCalls[0].value, SUPPORT_EMAIL);
  assert.equal(automation.contactQueryCalls[0].limit, 2);
  assert.equal(automation.contactQueryCalls[0].options.suppressAuth, true);
});

test('keeps the ticket and records an alert when the support contact cannot be resolved', async () => {
  const automation = loadAutomation({
    randomValues: [0],
    supportContacts: []
  });

  await automation.invoke({ payload: formPayload() });

  assert.equal(automation.createCalls.length, 1);
  assert.equal(automation.emailCalls.length, 1);
  assert.equal(automation.emailCalls[0][0], 'VPeL0Z3');
  assert.equal(
    automation.alertBodies.some((body) => body.includes('Support notification email was not sent automatically')),
    true
  );
});

test('retries when the generated number already exists', async () => {
  const automation = loadAutomation({
    ticketNumberPages: [[15_567_173]],
    randomValues: [
      randomForTicketNumber(15_567_173),
      randomForTicketNumber(15_567_174)
    ]
  });

  await automation.invoke({ payload: formPayload() });

  const createdColumns = JSON.parse(automation.createCalls[0].columnValues);
  assert.equal(createdColumns[TICKET_NUMBER_COLUMN_ID], '15567174');
  assert.equal(automation.emailCalls[0][2].variables.ticketNumber, '15567174');
});

test('checks every Monday page before selecting a unique number', async () => {
  const automation = loadAutomation({
    ticketNumberPages: [[15_567_173], [15_567_174]],
    randomValues: [
      randomForTicketNumber(15_567_173),
      randomForTicketNumber(15_567_174),
      randomForTicketNumber(15_567_175)
    ]
  });

  await automation.invoke({ payload: formPayload() });

  const createdColumns = JSON.parse(automation.createCalls[0].columnValues);
  assert.equal(createdColumns[TICKET_NUMBER_COLUMN_ID], '15567175');
  assert.deepEqual(
    automation.operationCalls.slice(0, 3),
    ['get_ticket_numbers', 'get_next_ticket_numbers', 'create_item']
  );
});

test('does not create a ticket when no unique number can be generated', async () => {
  const repeatedNumber = 15_567_173;
  const automation = loadAutomation({
    ticketNumberPages: [[repeatedNumber]],
    randomValues: [randomForTicketNumber(repeatedNumber)]
  });

  await assert.rejects(
    automation.invoke({ payload: formPayload() }),
    /Could not generate a unique eight-digit ticket number/
  );
  assert.equal(automation.createCalls.length, 0);
  assert.equal(automation.emailCalls.length, 0);
});
