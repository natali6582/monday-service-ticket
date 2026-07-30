/**
 * Wix Velo PAGE code for plan-t.org.il/support
 *
 * Drives the two-level topic tree, progressive disclosure and real-time
 * validation defined in developer field spec v1.2 and screen spec v3.4.
 *
 * This file runs in the page's frontend code panel, NOT in the automation.
 * It does not talk to Monday and it never sees MONDAY_API_KEY: it collects the
 * submission and hands it to the existing Wix Automation, which runs
 * monday_ticket.js as its action.
 *
 * ---------------------------------------------------------------------------
 * REQUIRED ELEMENT IDS — set these in the Wix editor before pasting.
 * Every id below must exist on the page or onReady throws by design, so a
 * missing element fails loudly at deploy time instead of silently at runtime.
 * ---------------------------------------------------------------------------
 *   #inputFullName     Text Input
 *   #inputOfficeName   Text Input
 *   #inputEmail        Text Input  (type: email)
 *   #inputPhone        Text Input  (type: phone)
 *   #dropdownTopic     Dropdown    (leave the option list EMPTY - filled here)
 *   #dropdownSubtopic  Dropdown    (empty; collapsed on load)
 *   #dropdownDetail    Dropdown    (empty; collapsed on load)
 *   #inputScreenUrl    Text Input  (type: url)
 *   #inputDescription  Text Box
 *   #buttonSubmit      Button
 *   #textIdWarning     Text        (Israeli-ID warning; collapsed on load)
 *   #groupForm         Container   (everything above)
 *   #groupConfirm      Container   (confirmation state; collapsed on load)
 *   #textErrFullName / #textErrOfficeName / #textErrEmail / #textErrPhone /
 *   #textErrTopic / #textErrSubtopic / #textErrDescription
 *                      Text        (one per validated field; collapsed on load)
 */

import { openServiceTicket } from 'backend/support.jsw';

/* ============================================================================
   Topic tree — developer field spec v1.2 section 03, one to one.
   These exact strings are also the label -> Monday dropdown id map inside
   monday_ticket.js. If a string changes here it must change there too, or the
   dropdown column is skipped (the free-text topic column still records it).
   ============================================================================ */
const TOPICS = [
  {
    name: 'טעינת קבצים וממשקים',
    subs: [
      'קובץ נכשל בטעינה',
      'נתונים חסרים או שגויים לאחר טעינה',
      'פורמט או יצרן שאינו נתמך',
      'ממשק מסלקה / קופות',
      'אחר'
    ],
    detail: {
      label: 'יצרן / סוג הקובץ',
      options: [
        'מסלקה פנסיונית',
        'קובץ יצרן (חברת ביטוח / בית השקעות)',
        'קובץ בנק / ברוקר',
        'קובץ אקסל ידני',
        'אחר'
      ]
    }
  },
  {
    name: 'הפקת דוחות',
    subs: ['הדוח לא נוצר או נתקע', 'נתון שגוי בדוח', 'עיצוב או תצוגה בדוח', 'ייצוא PDF / הדפסה'],
    detail: {
      label: 'איזה דוח?',
      options: ['דוח תקופתי', 'דוח פנסיה פלוס', 'דוח תכנון', 'אחר']
    }
  },
  {
    name: 'נתונים שגויים או חסרים',
    subs: ['שווי נכס שגוי', 'תשואה שגויה', 'נכס או חשבון חסר', 'שערי מטבע / מחירי נייר'],
    detail: {
      label: 'סוג הנכס (ללא שם הלקוח)',
      options: ['ני"ע סחיר', 'קרן / קופה פנסיונית', 'השקעה אלטרנטיבית', 'נדל"ן', 'אחר']
    }
  },
  {
    name: 'תקלה במערכת',
    subs: ['מסך לא נטען / שגיאת מערכת', 'איטיות בביצועים', 'בעיית תצוגה'],
    detail: null
  },
  {
    name: 'תפעול, משתמשים והרשאות',
    subs: ['התחברות וסיסמה', 'הוספה / הסרה של משתמש', 'הרשאות וצפייה', 'הגדרות משרד'],
    detail: null
  },
  {
    name: 'פורטל לקוחות',
    subs: ['לקוח קצה לא מצליח להתחבר', 'תצוגה או נתונים בפורטל'],
    detail: null
  },
  {
    name: 'הדרכה ושאלת שימוש',
    subs: ['איך עושים…?', 'בקשת הדרכה למשרד'],
    detail: null
  },
  {
    name: 'הצעת שיפור',
    subs: ['פיצ\'ר חדש', 'שיפור למסך או דוח קיים'],
    detail: null
  },
  {
    name: 'מנוי וחיוב',
    subs: ['חשבונית / חיוב', 'שינוי מסלול או מספר משתמשים'],
    detail: null
  },
  {
    name: 'אחר',
    subs: ['אחר'],
    detail: null
  }
];

/** Field labels sent to the automation. Must match the labels monday_ticket.js reads. */
const SUBMISSION_LABELS = {
  fullName: 'שם מלא',
  officeName: 'שם המשרד',
  email: 'מייל',
  phone: 'טלפון',
  topic: 'נושא הבעיה',
  subtopic: 'תת-נושא',
  screenUrl: 'קישור למסך שבו נתקלתם בבעיה (URL)',
  description: 'תיאור התקלה'
};

/** Validation messages — developer field spec v1.2 section 05, one to one. */
const ERRORS = {
  fullName: 'נא להזין שם מלא',
  officeName: 'נא להזין את שם המשרד',
  email: 'כתובת המייל אינה תקינה — בדקו שיש @ וסיומת',
  phone: 'מספר הטלפון צריך להכיל 9–10 ספרות',
  choose: 'נא לבחור מהרשימה',
  description: 'נא לפרט לפחות 20 תווים — זה עוזר לנו לטפל מהר יותר'
};

const PLACEHOLDER_TOPIC = 'בחרו נושא…';
const PLACEHOLDER_SUBTOPIC = 'בחרו תת-נושא…';
const PLACEHOLDER_DETAIL = 'בחרו מהרשימה…';

/** Validated fields: input element id -> its error text element id. */
const VALIDATED = [
  { key: 'fullName', input: '#inputFullName', error: '#textErrFullName' },
  { key: 'officeName', input: '#inputOfficeName', error: '#textErrOfficeName' },
  { key: 'email', input: '#inputEmail', error: '#textErrEmail' },
  { key: 'phone', input: '#inputPhone', error: '#textErrPhone' },
  { key: 'topic', input: '#dropdownTopic', error: '#textErrTopic' },
  { key: 'subtopic', input: '#dropdownSubtopic', error: '#textErrSubtopic' },
  { key: 'description', input: '#inputDescription', error: '#textErrDescription' }
];

$w.onReady(() => {
  assertElementsExist();

  collapse('#dropdownSubtopic');
  collapse('#dropdownDetail');
  collapse('#textIdWarning');
  collapse('#groupConfirm');
  VALIDATED.forEach((field) => collapse(field.error));

  $w('#dropdownTopic').options = optionsFrom(TOPICS.map((topic) => topic.name));
  $w('#dropdownTopic').placeholder = PLACEHOLDER_TOPIC;
  $w('#dropdownSubtopic').placeholder = PLACEHOLDER_SUBTOPIC;
  $w('#dropdownDetail').placeholder = PLACEHOLDER_DETAIL;

  $w('#dropdownTopic').onChange(() => applyTopicSelection());

  VALIDATED.forEach((field) => {
    const element = $w(field.input);
    // Error appears under the field on blur, never as a banner on submit.
    if (typeof element.onBlur === 'function') {
      element.onBlur(() => showFieldState(field));
    }
    if (typeof element.onChange === 'function') {
      element.onChange(() => {
        if (isFieldValid(field.key)) collapse(field.error);
      });
    }
  });

  $w('#inputDescription').onInput(() => {
    // Gentle Israeli-ID detection — screen spec v3.4 section 03 recommendation.
    const hasIdPattern = /(?:^|\D)\d{9}(?:\D|$)/.test(String($w('#inputDescription').value || ''));
    if (hasIdPattern) expand('#textIdWarning');
    else collapse('#textIdWarning');
  });

  $w('#buttonSubmit').onClick(() => submitTicket());
});

/**
 * Progressive disclosure — developer field spec v1.2 section 02.
 * Subtopic and detail values reset on every topic change, so a stale value from
 * a previously selected topic can never reach Monday.
 */
function applyTopicSelection() {
  const selectedName = String($w('#dropdownTopic').value || '');
  const topic = TOPICS.find((candidate) => candidate.name === selectedName);

  collapse('#textErrTopic');
  collapse('#textErrSubtopic');

  if (!topic) {
    resetDropdown('#dropdownSubtopic');
    resetDropdown('#dropdownDetail');
    collapse('#dropdownSubtopic');
    collapse('#dropdownDetail');
    return;
  }

  $w('#dropdownSubtopic').options = optionsFrom(topic.subs);
  $w('#dropdownSubtopic').value = undefined;
  expand('#dropdownSubtopic');

  if (topic.detail) {
    $w('#dropdownDetail').options = optionsFrom(topic.detail.options);
    $w('#dropdownDetail').value = undefined;
    $w('#dropdownDetail').placeholder = topic.detail.label;
    expand('#dropdownDetail');
  } else {
    resetDropdown('#dropdownDetail');
    collapse('#dropdownDetail');
  }
}

async function submitTicket() {
  let firstInvalid = null;

  VALIDATED.forEach((field) => {
    const valid = showFieldState(field);
    if (!valid && !firstInvalid) firstInvalid = field;
  });

  if (firstInvalid) {
    $w(firstInvalid.input).focus();
    return;
  }

  $w('#buttonSubmit').disable();

  try {
    await openServiceTicket(buildSubmission());
    collapse('#groupForm');
    expand('#groupConfirm');
    $w('#groupConfirm').scrollTo();
  } catch (error) {
    // Never strand the visitor on a dead button: re-enable so they can retry.
    console.error('Service ticket submission failed', error);
    $w('#buttonSubmit').enable();
    $w('#buttonSubmit').label = 'לא הצלחנו לשלוח — נסו שוב';
  }
}

/**
 * Builds the payload in the shape monday_ticket.js already expects
 * (`submissions` as label/value pairs), so the automation action needs no
 * change to read these fields.
 */
function buildSubmission() {
  const detailVisible = !isCollapsed('#dropdownDetail');
  const subtopicVisible = !isCollapsed('#dropdownSubtopic');

  const submissions = [
    { label: SUBMISSION_LABELS.fullName, value: valueOf('#inputFullName') },
    { label: SUBMISSION_LABELS.officeName, value: valueOf('#inputOfficeName') },
    { label: SUBMISSION_LABELS.email, value: valueOf('#inputEmail') },
    { label: SUBMISSION_LABELS.phone, value: valueOf('#inputPhone') },
    { label: SUBMISSION_LABELS.topic, value: valueOf('#dropdownTopic') },
    { label: SUBMISSION_LABELS.screenUrl, value: valueOf('#inputScreenUrl') },
    { label: SUBMISSION_LABELS.description, value: valueOf('#inputDescription') }
  ];

  if (subtopicVisible) {
    submissions.push({ label: SUBMISSION_LABELS.subtopic, value: valueOf('#dropdownSubtopic') });
  }

  // The conditional field carries the topic's own label, which is exactly what
  // monday_ticket.js looks for (TOPIC_DETAIL_FIELD_LABELS).
  if (detailVisible) {
    const topic = TOPICS.find((candidate) => candidate.name === valueOf('#dropdownTopic'));
    if (topic && topic.detail) {
      submissions.push({ label: topic.detail.label, value: valueOf('#dropdownDetail') });
    }
  }

  return { submissions: submissions.filter((entry) => entry.value !== '') };
}

/* ---------------------------------------------------------------- validation */

function isFieldValid(key) {
  if (key === 'fullName') return valueOf('#inputFullName').length >= 2;
  if (key === 'officeName') return valueOf('#inputOfficeName').length > 0;
  if (key === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valueOf('#inputEmail'));
  if (key === 'phone') {
    const digits = valueOf('#inputPhone').replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 10;
  }
  if (key === 'description') return valueOf('#inputDescription').length >= 20;
  if (key === 'topic') return valueOf('#dropdownTopic') !== '';
  // Subtopic is required only while it is visible — spec v1.2 section 02.
  if (key === 'subtopic') return isCollapsed('#dropdownSubtopic') || valueOf('#dropdownSubtopic') !== '';
  return true;
}

function showFieldState(field) {
  const valid = isFieldValid(field.key);
  if (valid) {
    collapse(field.error);
    return true;
  }
  $w(field.error).text = messageFor(field.key);
  expand(field.error);
  return false;
}

function messageFor(key) {
  if (key === 'topic' || key === 'subtopic') return ERRORS.choose;
  return ERRORS[key] || ERRORS.choose;
}

/* ------------------------------------------------------------------- helpers */

function optionsFrom(values) {
  return values.map((value) => ({ label: value, value }));
}

function resetDropdown(selector) {
  $w(selector).options = [];
  $w(selector).value = undefined;
}

function valueOf(selector) {
  return String($w(selector).value || '').trim();
}

function collapse(selector) {
  $w(selector).collapse();
}

function expand(selector) {
  $w(selector).expand();
}

function isCollapsed(selector) {
  return $w(selector).collapsed;
}

/**
 * Fails loudly at page load if the editor is missing an element this code
 * drives, instead of throwing mid-submission when a visitor is waiting.
 */
function assertElementsExist() {
  const required = [
    '#inputFullName', '#inputOfficeName', '#inputEmail', '#inputPhone',
    '#dropdownTopic', '#dropdownSubtopic', '#dropdownDetail',
    '#inputScreenUrl', '#inputDescription', '#buttonSubmit',
    '#textIdWarning', '#groupForm', '#groupConfirm',
    ...VALIDATED.map((field) => field.error)
  ];

  const missing = required.filter((selector) => {
    try {
      return !$w(selector) || typeof $w(selector).id !== 'string';
    } catch (error) {
      return true;
    }
  });

  if (missing.length > 0) {
    throw new Error(`Support page is missing required elements: ${missing.join(', ')}`);
  }
}
