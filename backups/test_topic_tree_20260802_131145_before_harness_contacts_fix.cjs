const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE_PATH = path.resolve(__dirname, '..', 'monday_ticket.js');
const LEGACY_TOPIC_COLUMN_ID = 'text_mm4zj908';
const TOPIC_COLUMN_ID = 'dropdown_mm5qsryr';
const SUBTOPIC_COLUMN_ID = 'dropdown_mm5q7p43';
const TOPIC_DETAIL_COLUMN_ID = 'dropdown_mm5q9dm4';
const SOURCE_COLUMN_ID = 'text_mm5qwrmt';
const DESCRIPTION_COLUMN_ID = 'long_text_mm4z5fr0';
const URL_COLUMN_ID = 'link_mm4z30wa';

function mondayResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data })
  };
}

function loadAutomation() {
  let source = fs.readFileSync(SOURCE_PATH, 'utf8');
  source = source
    .replace(/^import .*;\s*$/gm, '')
    .replace('export const invoke', 'const invoke');
  source += `
    globalThis.__ticketAutomation = { invoke };
  `;

  const createCalls = [];
  const supportTriggerCalls = [];

  const fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const query = request.query;
    const variables = request.variables;

    if (query.includes('GetTicketNumbers')) {
      return mondayResponse({
        boards: [{ items_page: { cursor: null, items: [] } }]
      });
    }
    if (query.includes('CreateServiceTicket')) {
      createCalls.push(variables);
      return mondayResponse({ create_item: { id: '3091574540', name: variables.itemName } });
    }
    if (query.includes('GetCustomerItems')) {
      return mondayResponse({ boards: [{ items_page: { cursor: null, items: [] } }] });
    }
    if (query.includes('CreateCustomerLinkAlert')) {
      return mondayResponse({ create_update: { id: 'update-1' } });
    }

    throw new Error(`Unexpected Monday query: ${query}`);
  };

  const math = Object.create(Math);
  math.random = () => 0;

  const context = {
    console: { log() {}, error() {} },
    fetch,
    getSecret: async () => 'test-token',
    triggeredEmails: { emailContact: async () => {} },
    customTrigger: {
      runTrigger: async (options) => {
        supportTriggerCalls.push(options);
      }
    },
    auth: { elevate: (fn) => fn },
    Math: math
  };
  vm.createContext(context);
  new vm.Script(source, { filename: SOURCE_PATH }).runInContext(context);

  return {
    invoke: context.__ticketAutomation.invoke,
    createCalls,
    supportTriggerCalls
  };
}

function payloadFrom(submissions) {
  return {
    contactId: 'contact-123',
    submissionId: 'submission-789',
    submissionTime: '2026-07-29T08:15:00.000Z',
    submissions
  };
}

/** A submission using the exact field labels required by developer spec v1.2. */
function specPayload(overrides = []) {
  return payloadFrom([
    { label: 'שם מלא', value: 'דנה כהן' },
    { label: 'שם המשרד', value: 'משרד כהן' },
    { label: 'מייל', value: 'dana@example.com' },
    { label: 'טלפון', value: '052-123-4567' },
    { label: 'נושא הבעיה', value: 'הפקת דוחות' },
    { label: 'תת-נושא', value: 'נתון שגוי בדוח' },
    { label: 'איזה דוח?', value: 'דוח תקופתי' },
    { label: 'קישור למסך שבו נתקלתם בבעיה (URL)', value: 'https://www.plan-t.org.il/reports' },
    { label: 'תיאור התקלה', value: 'ניסיתי להפיק דוח תקופתי והנתון של יולי שגוי.' },
    ...overrides
  ]);
}

/** A submission using the labels the live production form sends today. */
function legacyPayload() {
  return payloadFrom([
    { label: 'שם מלא', value: 'דנה כהן' },
    { label: 'שם המשרד', value: 'משרד כהן' },
    { label: 'מייל', value: 'dana@example.com' },
    { label: 'טלפון', value: '052-123-4567' },
    { label: 'נושא הבעיה', value: 'הפקת דוחות' },
    { label: 'כתובת URL', value: 'https://www.plan-t.org.il/reports' },
    { label: 'אנא פרט על התקלה שמוצגת לך', value: 'הדוח לא נוצר.' }
  ]);
}

async function createdColumnsFor(payload) {
  const automation = loadAutomation();
  await automation.invoke({ payload });
  assert.equal(automation.createCalls.length, 1);
  return {
    columns: JSON.parse(automation.createCalls[0].columnValues),
    itemName: automation.createCalls[0].itemName,
    supportTriggerCalls: automation.supportTriggerCalls
  };
}

test('writes topic, subtopic and detail as Monday dropdown label ids', async () => {
  const { columns } = await createdColumnsFor(specPayload());

  assert.deepEqual(columns[TOPIC_COLUMN_ID], { ids: [2] });
  assert.deepEqual(columns[SUBTOPIC_COLUMN_ID], { ids: [6] });
  assert.deepEqual(columns[TOPIC_DETAIL_COLUMN_ID], { ids: [5] });
});

test('keeps writing the legacy free-text topic column alongside the dropdown', async () => {
  const { columns } = await createdColumnsFor(specPayload());

  assert.equal(columns[LEGACY_TOPIC_COLUMN_ID], 'הפקת דוחות');
});

test('names the item topic, subtopic and office joined with a middle dot', async () => {
  const { itemName } = await createdColumnsFor(specPayload());

  assert.equal(itemName, 'הפקת דוחות · נתון שגוי בדוח · משרד כהן');
});

test('reads the description from the spec label "תיאור התקלה"', async () => {
  const { columns } = await createdColumnsFor(specPayload());

  assert.deepEqual(columns[DESCRIPTION_COLUMN_ID], {
    text: 'ניסיתי להפיק דוח תקופתי והנתון של יולי שגוי.'
  });
});

test('reads the screen link from the spec label with the (URL) suffix', async () => {
  const { columns } = await createdColumnsFor(specPayload());

  assert.deepEqual(columns[URL_COLUMN_ID], {
    url: 'https://www.plan-t.org.il/reports',
    text: 'https://www.plan-t.org.il/reports'
  });
});

test('accepts every per-topic label of the conditional follow-up field', async () => {
  const cases = [
    { label: 'יצרן / סוג הקובץ', value: 'מסלקה פנסיונית', expectedId: 1 },
    { label: 'איזה דוח?', value: 'דוח פנסיה פלוס', expectedId: 6 },
    { label: 'סוג הנכס (ללא שם הלקוח)', value: 'נדל"ן', expectedId: 11 },
    { label: 'פירוט נושא', value: 'אחר', expectedId: 12 }
  ];

  for (const testCase of cases) {
    const payload = payloadFrom([
      { label: 'שם מלא', value: 'דנה כהן' },
      { label: 'מייל', value: 'dana@example.com' },
      { label: 'נושא הבעיה', value: 'טעינת קבצים וממשקים' },
      { label: 'תת-נושא', value: 'קובץ נכשל בטעינה' },
      { label: testCase.label, value: testCase.value },
      { label: 'תיאור התקלה', value: 'הקובץ לא נטען.' }
    ]);

    const { columns } = await createdColumnsFor(payload);
    assert.deepEqual(
      columns[TOPIC_DETAIL_COLUMN_ID],
      { ids: [testCase.expectedId] },
      `follow-up label "${testCase.label}" was not mapped`
    );
  }
});

test('always stamps the source column with the support page value', async () => {
  const spec = await createdColumnsFor(specPayload());
  const legacy = await createdColumnsFor(legacyPayload());

  assert.equal(spec.columns[SOURCE_COLUMN_ID], 'support page');
  assert.equal(legacy.columns[SOURCE_COLUMN_ID], 'support page');
});

test('still accepts the labels the live production form sends today', async () => {
  const { columns, itemName } = await createdColumnsFor(legacyPayload());

  assert.equal(columns[LEGACY_TOPIC_COLUMN_ID], 'הפקת דוחות');
  assert.deepEqual(columns[TOPIC_COLUMN_ID], { ids: [2] });
  assert.deepEqual(columns[DESCRIPTION_COLUMN_ID], { text: 'הדוח לא נוצר.' });
  assert.deepEqual(columns[URL_COLUMN_ID], {
    url: 'https://www.plan-t.org.il/reports',
    text: 'https://www.plan-t.org.il/reports'
  });
  assert.equal(itemName, 'הפקת דוחות · משרד כהן');
});

test('omits a dropdown column when the submitted value is not a known label', async () => {
  const payload = payloadFrom([
    { label: 'שם מלא', value: 'דנה כהן' },
    { label: 'מייל', value: 'dana@example.com' },
    { label: 'נושא הבעיה', value: 'משהו שלא קיים בעץ' },
    { label: 'תת-נושא', value: 'גם זה לא קיים' },
    { label: 'תיאור התקלה', value: 'תיאור כלשהו.' }
  ]);

  const { columns, itemName } = await createdColumnsFor(payload);

  assert.equal(TOPIC_COLUMN_ID in columns, false);
  assert.equal(SUBTOPIC_COLUMN_ID in columns, false);
  assert.equal(columns[LEGACY_TOPIC_COLUMN_ID], 'משהו שלא קיים בעץ');
  assert.equal(itemName, 'משהו שלא קיים בעץ · גם זה לא קיים');
});

test('omits the conditional column for topics that have no follow-up field', async () => {
  const payload = payloadFrom([
    { label: 'שם מלא', value: 'דנה כהן' },
    { label: 'מייל', value: 'dana@example.com' },
    { label: 'נושא הבעיה', value: 'תקלה במערכת' },
    { label: 'תת-נושא', value: 'איטיות בביצועים' },
    { label: 'תיאור התקלה', value: 'המסך נטען לאט מאוד.' }
  ]);

  const { columns } = await createdColumnsFor(payload);

  assert.deepEqual(columns[TOPIC_COLUMN_ID], { ids: [4] });
  assert.deepEqual(columns[SUBTOPIC_COLUMN_ID], { ids: [14] });
  assert.equal(TOPIC_DETAIL_COLUMN_ID in columns, false);
});

test('tolerates label whitespace and a trailing colon from the Wix editor', async () => {
  const payload = payloadFrom([
    { label: 'שם מלא:', value: 'דנה כהן' },
    { label: 'מייל', value: 'dana@example.com' },
    { label: 'נושא הבעיה:', value: '  הפקת דוחות  ' },
    { label: 'תת-נושא:', value: 'נתון שגוי בדוח' },
    { label: 'תיאור התקלה:', value: 'נתון שגוי בדוח התקופתי.' }
  ]);

  const { columns } = await createdColumnsFor(payload);

  assert.deepEqual(columns[TOPIC_COLUMN_ID], { ids: [2] });
  assert.deepEqual(columns[SUBTOPIC_COLUMN_ID], { ids: [6] });
});

test('passes the classification fields to the support notification automation', async () => {
  const { supportTriggerCalls } = await createdColumnsFor(specPayload());

  assert.equal(supportTriggerCalls.length, 1);
  assert.equal(supportTriggerCalls[0].payload.subtopic, 'נתון שגוי בדוח');
  assert.equal(supportTriggerCalls[0].payload.topicDetail, 'דוח תקופתי');
});

test('reports the follow-up fields as not provided when the form omits them', async () => {
  const { supportTriggerCalls } = await createdColumnsFor(legacyPayload());

  assert.equal(supportTriggerCalls[0].payload.subtopic, 'לא נמסר');
  assert.equal(supportTriggerCalls[0].payload.topicDetail, 'לא נמסר');
});
