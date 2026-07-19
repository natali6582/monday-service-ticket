import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import { customTrigger } from '@wix/automations';
import { auth } from '@wix/essentials';

const MONDAY_SECRET_NAME = 'MONDAY_API_KEY';
const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = 5099744321;
const GROUP_ID = 'group_mm4zp44x';
const TICKET_NUMBER_COLUMN_ID = 'numeric_mm59qx9e';
const EMAIL_TRIGGER_ID = 'f6af7c3c-a858-4b7c-97a0-8e4ea8db3206';

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
  const issueDetails = pickField(fields, ['אנא פרט על התקלה שמוצגת לך', 'פירוט התקלה', 'Issue Details', 'Details']);
  const pageUrl = pickField(fields, ['כתובת URL', 'URL', 'Url', 'Page URL']);
  const urgency = normalizeUrgency(pickField(fields, ['דחיפות הפנייה', 'דחיפות', 'Urgency'])) || 'Medium';

  const columnValues = removeEmptyValues({
    text_mm4z7w7p: customerName,
    phone_mm4zny3f: phone ? { phone, countryShortName: 'IL' } : undefined,
    email_mm4zg2ya: email ? { email, text: email } : undefined,
    text_mm4z19j6: officeName,
    text_mm4zj908: issueSubject,
    long_text_mm4z5fr0: issueDetails ? { text: issueDetails } : undefined,
    link_mm4z30wa: pageUrl ? { url: pageUrl, text: pageUrl } : undefined,
    color_mm4zzdme: { label: 'Open' },
    color_mm4ze6f3: { label: urgency }
  });

  const itemName = issueSubject || customerName || payload?.submissionId || 'Service request';
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
  const ticketNumber = toSafeTicketNumber(createdItem?.id);

  await setMondayTicketNumber(mondayAuthorization, createdItem.id, ticketNumber);
  await runTicketEmailAutomation(removeEmptyValues({
    ticketNumber,
    contactId: payload?.contactId,
    wixSubmissionId: payload?.submissionId,
    customerName,
    customerEmail: email,
    phone,
    officeName,
    issueSubject,
    issueDetails,
    pageUrl,
    urgency,
    submissionTime: payload?.submissionTime
  }));

  console.log('Monday item created and ticket email trigger queued', {
    itemId: createdItem.id,
    ticketNumber
  });
  return {};
};

async function setMondayTicketNumber(mondayAuthorization, itemId, ticketNumber) {
  const mutation = `
    mutation SetTicketNumber($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) {
        id
      }
    }
  `;

  await executeMondayRequest(
    mondayAuthorization,
    mutation,
    {
      boardId: BOARD_ID,
      itemId,
      columnId: TICKET_NUMBER_COLUMN_ID,
      value: String(ticketNumber)
    },
    'change_simple_column_value'
  );
}

async function runTicketEmailAutomation(payload) {
  const runTrigger = auth.elevate(customTrigger.runTrigger);
  await runTrigger({
    triggerId: EMAIL_TRIGGER_ID,
    payload
  });
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

function toSafeTicketNumber(value) {
  const ticketNumber = Number(value);
  if (!Number.isSafeInteger(ticketNumber) || ticketNumber <= 0) {
    throw new Error(`Monday returned an invalid numeric item ID: ${value}`);
  }
  return ticketNumber;
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
