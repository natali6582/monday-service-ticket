import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const MONDAY_SECRET_NAME = 'MONDAY_API_KEY';
const MONDAY_API_URL = 'https://api.monday.com/v2';
const BOARD_ID = 5099744321;
const GROUP_ID = 'group_mm4zp44x';

/**
 * Autocomplete function declaration, do not delete
 * @param {import('./__schema__.js').Payload} options
 */
export const invoke = async ({ payload }) => {
  const mondayToken = await getSecret(MONDAY_SECRET_NAME);
  if (!mondayToken) {
    throw new Error(`Missing Wix secret: ${MONDAY_SECRET_NAME}`);
  }

  const fields = buildSubmissionLookup(payload);
  const customerName = pickField(fields, ['שם מלא', 'שם הלקוח', 'Full Name', 'Customer Name', 'Name']);
  const phone = pickField(fields, ['טלפון', 'Phone', 'Phone Number']);
  const email = pickField(fields, ['מייל', 'אימייל', 'Email']);
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

  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: mondayToken,
      'API-Version': '2024-01'
    },
    body: JSON.stringify({
      query,
      variables: {
        boardId: BOARD_ID,
        groupId: GROUP_ID,
        itemName,
        columnValues: JSON.stringify(columnValues)
      }
    })
  });

  const result = await response.json();
  if (!response.ok || result.errors) {
    console.error('Monday create_item failed', {
      status: response.status,
      errors: result.errors,
      responseData: result.data
    });
    throw new Error('Monday create_item failed. Check Wix Logs for the Monday API error details.');
  }

  console.log('Monday item created', result.data?.create_item?.id);
  return {};
};

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
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    return value.value || value.text || value.email || value.phone || value.url || JSON.stringify(value);
  }
  return String(value).trim();
}

function normalizeUrgency(value) {
  const urgency = normalizeLabel(value);
  if (!urgency) {
    return '';
  }
  if (['high', 'גבוה', 'גבוהה', 'דחוף'].includes(urgency)) {
    return 'High';
  }
  if (['low', 'נמוך', 'נמוכה'].includes(urgency)) {
    return 'Low';
  }
  return 'Medium';
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
