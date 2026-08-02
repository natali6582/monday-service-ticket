import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { triggeredEmails } from 'wix-crm-backend';
import { customTrigger } from '@wix/automations';
import { auth } from '@wix/essentials';

const MONDAY_SECRET_NAME = 'MONDAY_API_KEY';
const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = 5099744321;
const GROUP_ID = 'group_mm4zp44x';
const TICKET_NUMBER_COLUMN_ID = 'numeric_mm59qx9e';
const TICKET_NUMBER_MIN = 10000000;
const TICKET_NUMBER_MAX = 99999999;
const TICKET_NUMBER_ATTEMPTS = 100;
const TICKET_PAGE_LIMIT = 500;
const TRIGGERED_EMAIL_ID = 'VPeL0Z3';
const SUPPORT_AUTOMATION_TRIGGER_ID = 'f6af7c3c-a858-4b7c-97a0-8e4ea8db3206';
const PLAN_T_SITE_URL = 'https://www.plan-t.org.il/';
const CUSTOMER_BOARD_ID = 1988799742;
const CUSTOMER_EMAIL_COLUMN_ID = 'contact_email';
const CUSTOMER_PHONE_COLUMN_ID = 'contact_phone';
const CUSTOMER_RELATION_COLUMN_ID = 'board_relation_mm5ajg15';
const CUSTOMER_PAGE_LIMIT = 500;
const TOPIC_COLUMN_ID = 'dropdown_mm5qsryr';
const SUBTOPIC_COLUMN_ID = 'dropdown_mm5q7p43';
const TOPIC_DETAIL_COLUMN_ID = 'dropdown_mm5q9dm4';
const SOURCE_COLUMN_ID = 'text_mm5qwrmt';
const SOURCE_VALUE = 'support page';

/**
 * Topic tree per developer field spec v1.2 section 03.
 * Values are the exact dropdown labels created on board 5099744321; the numeric
 * ids are the Monday label ids, so a future wording change on the board does not
 * silently drop the value.
 */
const TOPIC_LABEL_IDS = {
  'טעינת קבצים וממשקים': 1,
  'הפקת דוחות': 2,
  'נתונים שגויים או חסרים': 3,
  'תקלה במערכת': 4,
  'תפעול, משתמשים והרשאות': 5,
  'פורטל לקוחות': 6,
  'הדרכה ושאלת שימוש': 7,
  'הצעת שיפור': 8,
  'מנוי וחיוב': 9,
  'אחר': 10
};

const SUBTOPIC_LABEL_IDS = {
  'קובץ נכשל בטעינה': 1,
  'נתונים חסרים או שגויים לאחר טעינה': 2,
  'פורמט או יצרן שאינו נתמך': 3,
  'ממשק מסלקה / קופות': 4,
  'הדוח לא נוצר או נתקע': 5,
  'נתון שגוי בדוח': 6,
  'עיצוב או תצוגה בדוח': 7,
  'ייצוא PDF / הדפסה': 8,
  'שווי נכס שגוי': 9,
  'תשואה שגויה': 10,
  'נכס או חשבון חסר': 11,
  'שערי מטבע / מחירי נייר': 12,
  'מסך לא נטען / שגיאת מערכת': 13,
  'איטיות בביצועים': 14,
  'בעיית תצוגה': 15,
  'התחברות וסיסמה': 16,
  'הוספה / הסרה של משתמש': 17,
  'הרשאות וצפייה': 18,
  'הגדרות משרד': 19,
  'לקוח קצה לא מצליח להתחבר': 20,
  'תצוגה או נתונים בפורטל': 21,
  'איך עושים…?': 22,
  'בקשת הדרכה למשרד': 23,
  'פיצ\'ר חדש': 24,
  'שיפור למסך או דוח קיים': 25,
  'חשבונית / חיוב': 26,
  'שינוי מסלול או מספר משתמשים': 27,
  'אחר': 28
};

const TOPIC_DETAIL_LABEL_IDS = {
  'מסלקה פנסיונית': 1,
  'קובץ יצרן (חברת ביטוח / בית השקעות)': 2,
  'קובץ בנק / ברוקר': 3,
  'קובץ אקסל ידני': 4,
  'דוח תקופתי': 5,
  'דוח פנסיה פלוס': 6,
  'דוח תכנון': 7,
  'ני"ע סחיר': 8,
  'קרן / קופה פנסיונית': 9,
  'השקעה אלטרנטיבית': 10,
  'נדל"ן': 11,
  'אחר': 12
};

/** The conditional follow-up field carries a different label per topic (v1.2 section 03). */
const TOPIC_DETAIL_FIELD_LABELS = [
  'פירוט נושא',
  'יצרן / סוג הקובץ',
  'איזה דוח?',
  'סוג הנכס (ללא שם הלקוח)'
];

/**
 * Autocomplete function declaration, do not delete
 * @param {import('./__schema__.js').Payload} options
 */
export const invoke = async ({ payload }) => {
  const mondayToken = await getSecret(MONDAY_SECRET_NAME);
  if (!mondayToken) {
    throw new Error(`Missing Wix secret: ${MONDAY_SECRET_NAME}`);
  }
  const mondayAuthorization = normalizeMondayToken(mondayToken);

  const fields = buildSubmissionLookup(payload);
  const customerName = pickField(fields, ['שם מלא', 'שם הלקוח', 'Full Name', 'Customer Name', 'Name']);
  const rawPhone = pickField(fields, ['טלפון', 'Phone', 'Phone Number']);
  const rawEmail = pickField(fields, ['מייל', 'אימייל', 'Email']);
  const phone = normalizeIsraeliPhone(rawPhone);
  const email = normalizeEmail(rawEmail);
  const officeName = pickField(fields, ['שם המשרד', 'Office Name', 'Office']);
  const issueSubject = pickField(fields, ['נושא הבעיה', 'Issue Subject', 'Subject']);
  const subtopic = pickField(fields, ['תת-נושא', 'תת נושא', 'Subtopic', 'Sub Topic']);
  const topicDetail = pickField(fields, [...TOPIC_DETAIL_FIELD_LABELS, 'Topic Detail']);
  const issueDetails = pickField(fields, ['תיאור התקלה', 'אנא פרט על התקלה שמוצגת לך', 'פירוט התקלה', 'Issue Details', 'Details']);
  const pageUrl = pickField(fields, ['קישור למסך שבו נתקלתם בבעיה (URL)', 'כתובת URL', 'URL', 'Url', 'Page URL']);
  const urgency = normalizeUrgency(pickField(fields, ['דחיפות הפנייה', 'דחיפות', 'Urgency'])) || 'Medium';

  const ticketNumber = await generateUniqueTicketNumber(mondayAuthorization);
  const columnValues = removeEmptyValues({
    text_mm4z7w7p: customerName,
    phone_mm4zny3f: phone ? { phone, countryShortName: 'IL' } : undefined,
    email_mm4zg2ya: email ? { email, text: email } : undefined,
    text_mm4z19j6: officeName,
    text_mm4zj908: issueSubject,
    long_text_mm4z5fr0: issueDetails ? { text: issueDetails } : undefined,
    link_mm4z30wa: pageUrl ? { url: pageUrl, text: pageUrl } : undefined,
    color_mm4zzdme: { index: 7 },
    color_mm4ze6f3: { label: urgency },
    [TICKET_NUMBER_COLUMN_ID]: String(ticketNumber),
    [TOPIC_COLUMN_ID]: dropdownValue(issueSubject, TOPIC_LABEL_IDS),
    [SUBTOPIC_COLUMN_ID]: dropdownValue(subtopic, SUBTOPIC_LABEL_IDS),
    [TOPIC_DETAIL_COLUMN_ID]: dropdownValue(topicDetail, TOPIC_DETAIL_LABEL_IDS),
    [SOURCE_COLUMN_ID]: SOURCE_VALUE
  });

  const itemName = buildItemName({
    topic: issueSubject,
    subtopic,
    officeName,
    customerName,
    fallbackId: payload?.submissionId
  });
  const query = `
    mutation CreateServiceTicket($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) {
        id
        name
      }
    }
  `;

  const createData = await executeMondayRequest(
    mondayAuthorization,
    query,
    {
      boardId: BOARD_ID,
      groupId: GROUP_ID,
      itemName,
      columnValues: JSON.stringify(columnValues)
    },
    'create_item'
  );

  const createdItem = createData?.create_item;
  const createdItemId = toSafeMondayItemId(createdItem?.id);

  const ticketEmailResult = await sendTicketConfirmationEmailSafely(
    mondayAuthorization,
    createdItemId,
    {
      contactId: payload?.contactId,
      customerName,
      ticketNumber,
      issueSubject
    }
  );
  const supportEmailResult = await sendSupportNotificationEmailSafely(
    mondayAuthorization,
    createdItemId,
    {
      contactId: payload?.contactId,
      submissionTime: payload?.submissionTime,
      wixSubmissionId: payload?.submissionId,
      customerName,
      customerEmail: email,
      customerPhone: phone,
      officeName,
      urgency,
      ticketNumber,
      issueSubject,
      subtopic,
      topicDetail,
      issueDetails,
      pageUrl
    }
  );
  const customerLinkResult = await linkCustomerToTicketSafely(
    mondayAuthorization,
    createdItemId,
    email,
    phone
  );

  console.log('Monday item created and customer confirmation processed', {
    itemId: createdItemId,
    ticketNumber,
    ticketEmailStatus: ticketEmailResult.status,
    supportEmailStatus: supportEmailResult.status,
    customerLinkStatus: customerLinkResult.status
  });
  return {};
};

async function generateUniqueTicketNumber(
  mondayAuthorization,
  request = executeMondayRequest,
  random = Math.random
) {
  const existingNumbers = await getExistingTicketNumbers(mondayAuthorization, request);
  const ticketNumberRange = TICKET_NUMBER_MAX - TICKET_NUMBER_MIN + 1;

  for (let attempt = 0; attempt < TICKET_NUMBER_ATTEMPTS; attempt += 1) {
    const ticketNumber = Math.floor(random() * ticketNumberRange) + TICKET_NUMBER_MIN;
    if (!existingNumbers.has(ticketNumber)) {
      return ticketNumber;
    }
  }

  throw new Error('Could not generate a unique eight-digit ticket number');
}

async function getExistingTicketNumbers(
  mondayAuthorization,
  request = executeMondayRequest
) {
  const firstPageQuery = `
    query GetTicketNumbers($boardIds: [ID!]!, $limit: Int!, $columnIds: [String!]) {
      boards(ids: $boardIds) {
        items_page(limit: $limit) {
          cursor
          items {
            column_values(ids: $columnIds) {
              id
              text
            }
          }
        }
      }
    }
  `;
  const nextPageQuery = `
    query GetNextTicketNumbers($cursor: String!, $limit: Int!, $columnIds: [String!]) {
      next_items_page(cursor: $cursor, limit: $limit) {
        cursor
        items {
          column_values(ids: $columnIds) {
            id
            text
          }
        }
      }
    }
  `;
  const columnIds = [TICKET_NUMBER_COLUMN_ID];
  const firstData = await request(
    mondayAuthorization,
    firstPageQuery,
    {
      boardIds: [BOARD_ID],
      limit: TICKET_PAGE_LIMIT,
      columnIds
    },
    'get_ticket_numbers'
  );
  const firstPage = firstData?.boards?.[0]?.items_page;
  if (!firstPage) {
    throw new Error(`Monday did not return service-ticket board ${BOARD_ID}`);
  }

  const ticketNumbers = new Set();
  addExistingTicketNumbers(ticketNumbers, firstPage.items);
  const seenCursors = new Set();
  let cursor = firstPage.cursor;

  while (cursor) {
    if (seenCursors.has(cursor)) {
      throw new Error('Monday returned a repeated ticket-number pagination cursor');
    }
    seenCursors.add(cursor);

    const nextData = await request(
      mondayAuthorization,
      nextPageQuery,
      {
        cursor,
        limit: TICKET_PAGE_LIMIT,
        columnIds
      },
      'get_next_ticket_numbers'
    );
    const nextPage = nextData?.next_items_page;
    if (!nextPage) {
      throw new Error('Monday did not return the next ticket-number page');
    }
    addExistingTicketNumbers(ticketNumbers, nextPage.items);
    cursor = nextPage.cursor;
  }

  return ticketNumbers;
}

function addExistingTicketNumbers(ticketNumbers, items) {
  for (const item of items || []) {
    const rawValue = item?.column_values?.find(
      (column) => column.id === TICKET_NUMBER_COLUMN_ID
    )?.text;
    const ticketNumber = Number(String(rawValue || '').replace(/,/g, '').trim());
    if (
      Number.isSafeInteger(ticketNumber)
      && ticketNumber >= TICKET_NUMBER_MIN
      && ticketNumber <= TICKET_NUMBER_MAX
    ) {
      ticketNumbers.add(ticketNumber);
    }
  }
}

async function sendTicketConfirmationEmailSafely(
  mondayAuthorization,
  ticketItemId,
  { contactId, customerName, ticketNumber, issueSubject },
  emailContact = triggeredEmails.emailContact,
  request = executeMondayRequest
) {
  try {
    const wixContactId = String(contactId || '').trim();
    if (!wixContactId) {
      throw new Error('Wix form payload is missing contactId');
    }

    await emailContact(TRIGGERED_EMAIL_ID, wixContactId, {
      variables: {
        customerName: customerName || '\u05dc\u05e7\u05d5\u05d7/\u05d4',
        ticketNumber: String(ticketNumber),
        issueSubject: issueSubject || '\u05e0\u05d5\u05e9\u05d0 \u05d4\u05e4\u05e0\u05d9\u05d9\u05d4',
        SITE_URL: PLAN_T_SITE_URL
      }
    });
    return { status: 'sent' };
  } catch (error) {
    console.error('Customer ticket confirmation email failed', {
      itemId: ticketItemId,
      error: error?.message || String(error)
    });

    try {
      await createCustomerLinkAlert(
        mondayAuthorization,
        ticketItemId,
        'Customer confirmation email was not sent automatically. Please send it manually and include the Monday ticket number.',
        request
      );
    } catch (alertError) {
      console.error('Could not add the email-failure alert to the Monday item', {
        itemId: ticketItemId,
        error: alertError?.message || String(alertError)
      });
    }

    return { status: 'failed' };
  }
}

async function sendSupportNotificationEmailSafely(
  mondayAuthorization,
  ticketItemId,
  {
    customerName,
    customerEmail,
    customerPhone,
    officeName,
    urgency,
    ticketNumber,
    issueSubject,
    subtopic,
    topicDetail,
    issueDetails,
    pageUrl,
    contactId,
    submissionTime,
    wixSubmissionId
  },
  runTrigger = runSupportAutomationTrigger,
  request = executeMondayRequest
) {
  try {
    const notProvided = '\u05dc\u05d0 \u05e0\u05de\u05e1\u05e8';

    await runTrigger({
      triggerId: SUPPORT_AUTOMATION_TRIGGER_ID,
      payload: {
        submissionTime: submissionTime || new Date().toISOString(),
        ticketNumber,
        customerName: customerName || notProvided,
        pageUrl: pageUrl || notProvided,
        officeName: officeName || notProvided,
        urgency: urgency || notProvided,
        issueDetails: issueDetails || notProvided,
        contactId: String(contactId || ''),
        customerEmail: customerEmail || '',
        wixSubmissionId: String(wixSubmissionId || ''),
        phone: customerPhone || notProvided,
        issueSubject: issueSubject || notProvided,
        subtopic: subtopic || notProvided,
        topicDetail: topicDetail || notProvided,
      }
    });
    return { status: 'sent' };
  } catch (error) {
    console.error('Support notification email failed', {
      itemId: ticketItemId,
      error: error?.message || String(error)
    });

    try {
      await createCustomerLinkAlert(
        mondayAuthorization,
        ticketItemId,
        'Support notification email was not sent automatically. The ticket was created successfully; please notify support manually and include the Monday ticket number.',
        request
      );
    } catch (alertError) {
      console.error('Could not add the support-email failure alert to the Monday item', {
        itemId: ticketItemId,
        error: alertError?.message || String(alertError)
      });
    }

    return { status: 'failed' };
  }
}

async function runSupportAutomationTrigger(options) {
  const elevatedRunTrigger = auth.elevate(customTrigger.runTrigger);
  return elevatedRunTrigger(options);
}

async function linkCustomerToTicketSafely(
  mondayAuthorization,
  ticketItemId,
  email,
  phone,
  request = executeMondayRequest
) {
  try {
    return await linkCustomerToTicket(
      mondayAuthorization,
      ticketItemId,
      email,
      phone,
      request
    );
  } catch (error) {
    console.error('Automatic customer linking failed', {
      itemId: ticketItemId,
      error: error?.message || String(error)
    });

    try {
      await createCustomerLinkAlert(
        mondayAuthorization,
        ticketItemId,
        '⚠️ הקישור האוטומטי נכשל טכנית. קריאת השירות נשמרה, אך יש לחפש ולקשר את הלקוח ידנית בעמודת "לקוח מקושר".',
        request
      );
    } catch (alertError) {
      console.error('Could not add the customer-linking alert to the Monday item', {
        itemId: ticketItemId,
        error: alertError?.message || String(alertError)
      });
    }

    return { status: 'technical_error' };
  }
}

async function linkCustomerToTicket(
  mondayAuthorization,
  ticketItemId,
  email,
  phone,
  request = executeMondayRequest
) {
  const customers = await getAllCustomerItems(mondayAuthorization, request);
  const match = resolveCustomerMatch(customers, email, phone);

  if (match.status === 'matched') {
    await setCustomerRelation(
      mondayAuthorization,
      ticketItemId,
      match.customerId,
      request
    );
    console.log('Monday service ticket linked to customer', {
      itemId: ticketItemId,
      customerId: match.customerId,
      matchedBy: match.matchedBy
    });
    return match;
  }

  await createCustomerLinkAlert(
    mondayAuthorization,
    ticketItemId,
    customerLinkAlertBody(match),
    request
  );
  return match;
}

async function getAllCustomerItems(mondayAuthorization, request = executeMondayRequest) {
  const firstPageQuery = `
    query GetCustomerItems($boardIds: [ID!]!, $limit: Int!, $columnIds: [String!]) {
      boards(ids: $boardIds) {
        items_page(limit: $limit) {
          cursor
          items {
            id
            name
            column_values(ids: $columnIds) {
              id
              text
            }
          }
        }
      }
    }
  `;
  const nextPageQuery = `
    query GetNextCustomerItems($cursor: String!, $limit: Int!, $columnIds: [String!]) {
      next_items_page(cursor: $cursor, limit: $limit) {
        cursor
        items {
          id
          name
          column_values(ids: $columnIds) {
            id
            text
          }
        }
      }
    }
  `;
  const columnIds = [CUSTOMER_EMAIL_COLUMN_ID, CUSTOMER_PHONE_COLUMN_ID];
  const firstData = await request(
    mondayAuthorization,
    firstPageQuery,
    {
      boardIds: [CUSTOMER_BOARD_ID],
      limit: CUSTOMER_PAGE_LIMIT,
      columnIds
    },
    'get_customer_items'
  );
  const firstPage = firstData?.boards?.[0]?.items_page;
  if (!firstPage) {
    throw new Error(`Monday did not return customer board ${CUSTOMER_BOARD_ID}`);
  }

  const customers = [...(firstPage.items || [])];
  const seenCursors = new Set();
  let cursor = firstPage.cursor;

  while (cursor) {
    if (seenCursors.has(cursor)) {
      throw new Error('Monday returned a repeated customer pagination cursor');
    }
    seenCursors.add(cursor);

    const nextData = await request(
      mondayAuthorization,
      nextPageQuery,
      {
        cursor,
        limit: CUSTOMER_PAGE_LIMIT,
        columnIds
      },
      'get_next_customer_items'
    );
    const nextPage = nextData?.next_items_page;
    if (!nextPage) {
      throw new Error('Monday did not return the next customer page');
    }
    customers.push(...(nextPage.items || []));
    cursor = nextPage.cursor;
  }

  return customers;
}

function resolveCustomerMatch(customers, email, phone) {
  const normalizedEmail = normalizeEmail(email).toLowerCase();
  const normalizedPhone = normalizeIsraeliPhone(phone);
  const emailMatches = normalizedEmail
    ? matchingCustomerIds(customers, CUSTOMER_EMAIL_COLUMN_ID, normalizedEmail, normalizeEmail)
    : [];
  const phoneMatches = normalizedPhone
    ? matchingCustomerIds(customers, CUSTOMER_PHONE_COLUMN_ID, normalizedPhone, normalizeIsraeliPhone)
    : [];

  if (emailMatches.length > 0 && phoneMatches.length > 0) {
    const phoneIds = new Set(phoneMatches);
    const intersection = emailMatches.filter((customerId) => phoneIds.has(customerId));
    if (intersection.length === 1) {
      return {
        status: 'matched',
        customerId: intersection[0],
        matchedBy: 'email_and_phone'
      };
    }
    if (intersection.length === 0) {
      return { status: 'conflict' };
    }
    return { status: 'ambiguous' };
  }

  if (emailMatches.length === 1) {
    return {
      status: 'matched',
      customerId: emailMatches[0],
      matchedBy: 'email'
    };
  }
  if (phoneMatches.length === 1) {
    return {
      status: 'matched',
      customerId: phoneMatches[0],
      matchedBy: 'phone'
    };
  }
  if (emailMatches.length > 1 || phoneMatches.length > 1) {
    return { status: 'ambiguous' };
  }
  return {
    status: 'not_found',
    missingIdentifiers: !normalizedEmail && !normalizedPhone
  };
}

function matchingCustomerIds(customers, columnId, expectedValue, normalize) {
  const matches = new Set();
  for (const customer of customers || []) {
    const rawValue = customer?.column_values?.find((column) => column.id === columnId)?.text;
    const normalizedValue = normalize(rawValue);
    const comparableValue = columnId === CUSTOMER_EMAIL_COLUMN_ID
      ? normalizedValue.toLowerCase()
      : normalizedValue;
    if (comparableValue && comparableValue === expectedValue) {
      matches.add(String(customer.id));
    }
  }
  return [...matches];
}

function customerLinkAlertBody(match) {
  if (match.status === 'conflict') {
    return '⚠️ האימייל והטלפון מצביעים על כרטיסי לקוח שונים. לא בוצע קישור אוטומטי; יש לבדוק ולקשר ידנית בעמודת "לקוח מקושר".';
  }
  if (match.status === 'ambiguous') {
    return '⚠️ נמצאו כמה כרטיסי לקוח אפשריים לפי האימייל או הטלפון. לא בוצע קישור אוטומטי; יש לבדוק ולקשר ידנית בעמודת "לקוח מקושר".';
  }
  if (match.missingIdentifiers) {
    return '⚠️ לא התקבלו אימייל או טלפון תקינים לצורך קישור הלקוח. יש לחפש ולקשר ידנית בעמודת "לקוח מקושר".';
  }
  return '⚠️ לא נמצא לקוח תואם במערכת — לא לפי מייל ולא לפי טלפון. יש לחפש ולקשר ידנית בעמודת "לקוח מקושר".';
}

async function setCustomerRelation(
  mondayAuthorization,
  ticketItemId,
  customerItemId,
  request = executeMondayRequest
) {
  const mutation = `
    mutation LinkCustomer($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(
        board_id: $boardId
        item_id: $itemId
        column_values: $columnValues
      ) {
        id
      }
    }
  `;
  const customerId = Number(customerItemId);
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error(`Cannot link an invalid Monday customer item ID: ${customerItemId}`);
  }

  await request(
    mondayAuthorization,
    mutation,
    {
      boardId: BOARD_ID,
      itemId: ticketItemId,
      columnValues: JSON.stringify({
        [CUSTOMER_RELATION_COLUMN_ID]: { item_ids: [customerId] }
      })
    },
    'link_customer_item'
  );
}

async function createCustomerLinkAlert(
  mondayAuthorization,
  ticketItemId,
  body,
  request = executeMondayRequest
) {
  const mutation = `
    mutation CreateCustomerLinkAlert($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  await request(
    mondayAuthorization,
    mutation,
    {
      itemId: ticketItemId,
      body
    },
    'create_customer_link_alert'
  );
}

async function executeMondayRequest(mondayAuthorization, query, variables, operationName) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: mondayAuthorization,
      'API-Version': '2026-04'
    },
    body: JSON.stringify({ query, variables })
  });

  const result = await response.json();
  const hasGraphQLErrors = Array.isArray(result.errors) ? result.errors.length > 0 : Boolean(result.errors);
  if (!response.ok || hasGraphQLErrors) {
    const mondayErrorMessage = Array.isArray(result.errors)
      ? result.errors.map((error) => error.message || error.error_message || JSON.stringify(error)).join(' | ')
      : JSON.stringify(result);

    console.error(`Monday ${operationName} failed`, {
      status: response.status,
      errors: result.errors,
      responseData: result.data
    });
    throw new Error(`Monday ${operationName} failed (${response.status}): ${mondayErrorMessage.slice(0, 800)}`);
  }

  return result.data;
}

function toSafeMondayItemId(value) {
  const itemId = Number(value);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) {
    throw new Error(`Monday returned an invalid numeric item ID: ${value}`);
  }
  return itemId;
}

function buildSubmissionLookup(payload = {}) {
  const lookup = {};
  const submissions = Array.isArray(payload.submissions) ? payload.submissions : [];

  for (const item of submissions) {
    if (!item || !item.label) {
      continue;
    }
    lookup[normalizeLabel(item.label)] = stringifyValue(item.value);
  }

  return lookup;
}

function pickField(fields, labels) {
  for (const label of labels) {
    const value = fields[normalizeLabel(label)];
    if (value) {
      return value;
    }
  }
  return '';
}

/**
 * Maps a submitted list value to its Monday dropdown label id.
 * Returns undefined for empty or unrecognized values so `removeEmptyValues`
 * drops the column instead of writing an invalid label.
 */
function dropdownValue(submittedLabel, labelIds) {
  const normalizedSubmitted = normalizeLabel(submittedLabel);
  if (!normalizedSubmitted) {
    return undefined;
  }

  for (const [label, id] of Object.entries(labelIds)) {
    if (normalizeLabel(label) === normalizedSubmitted) {
      return { ids: [id] };
    }
  }

  return undefined;
}

/**
 * Item name per developer field spec v1.2 section 04: topic, subtopic and office
 * joined with a middle dot. Falls back to the previous single-value behaviour
 * when the extra classification fields are absent.
 */
function buildItemName({ topic, subtopic, officeName, customerName, fallbackId }) {
  const parts = [topic, subtopic, officeName].filter(Boolean);
  if (parts.length > 1) {
    return parts.join(' · ');
  }
  return topic || customerName || fallbackId || 'Service request';
}

function normalizeLabel(value) {
  return String(value || '').replace(/[:：]\s*$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyValue).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    return value.value || value.text || value.email || value.phone || value.phoneNumber || value.formatted || value.url || JSON.stringify(value);
  }
  return String(value).trim();
}

function normalizeIsraeliPhone(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  const cleanValue = rawValue.replace(/[\u200e\u200f\u202a-\u202e]/g, '');
  const hasLeadingPlus = cleanValue.trim().startsWith('+');
  const digits = cleanValue.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (hasLeadingPlus && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  if (digits.startsWith('972')) {
    return `+${digits}`;
  }

  if (digits.startsWith('0') && digits.length >= 9) {
    return `+972${digits.slice(1)}`;
  }

  if (digits.startsWith('5') && digits.length === 9) {
    return `+972${digits}`;
  }

  if (digits.endsWith('972') && digits.length > 3) {
    const candidate = `+972${digits.slice(0, -3)}`;
    if (/^\+972\d{8,10}$/.test(candidate)) {
      return candidate;
    }
  }

  if (digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return '';
}

function normalizeEmail(value) {
  const email = String(value || '').trim().replace(/\s+/g, '');
  if (!email) {
    return '';
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeUrgency(value) {
  const urgency = normalizeLabel(value);
  if (!urgency) {
    return '';
  }
  if (['critical', 'קריטי', 'דחוף מאוד'].includes(urgency)) {
    return 'Critical';
  }
  if (['high', 'גבוה', 'גבוהה', 'דחוף'].includes(urgency)) {
    return 'High';
  }
  if (['low', 'נמוך', 'נמוכה'].includes(urgency)) {
    return 'Low';
  }
  return 'Medium';
}

function normalizeMondayToken(value) {
  return String(value).trim().replace(/^Bearer\s+/i, '');
}

function removeEmptyValues(values) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => {
      if (value === undefined || value === null || value === '') {
        return false;
      }
      if (typeof value === 'object' && !Array.isArray(value)) {
        return Object.values(value).some((nestedValue) => nestedValue !== undefined && nestedValue !== null && nestedValue !== '');
      }
      return true;
    })
  );
}
