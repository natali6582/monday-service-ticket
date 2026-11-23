const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPage() {
  const elements = new Map();
  const calls = [];

  function element(selector) {
    if (!elements.has(selector)) {
      const handlers = {};
      const input = {
        id: selector.slice(1),
        value: '',
        options: [],
        collapsed: false,
        required: false,
        disabled: false,
        focused: false,
        handlers,
        collapse() { this.collapsed = true; },
        expand() { this.collapsed = false; },
        disable() { this.disabled = true; },
        enable() { this.disabled = false; },
        focus() { this.focused = true; },
        scrollTo() {},
        resetValidityIndication() {},
        updateValidityIndication() {},
        onCustomValidation(callback) { this.validate = callback; }
      };
      for (const name of ['onChange', 'onFocus', 'onBlur', 'onInput', 'onClick']) {
        input[name] = (callback) => {
          if (!handlers[name]) handlers[name] = [];
          handlers[name].push(callback);
        };
      }
      elements.set(selector, input);
    }
    return elements.get(selector);
  }

  let ready;
  const wix = (selector) => element(selector);
  wix.onReady = (callback) => { ready = callback; };
  const context = vm.createContext({
    $w: wix,
    console: { log() {}, warn() {}, error() {} },
    openServiceTicket: async (payload) => {
      calls.push(JSON.parse(JSON.stringify(payload)));
      return { submissionId: 'offline-test' };
    }
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'support_page.js'), 'utf8');
  vm.runInContext(source.replace(/^import .*;\s*$/gm, ''), context);
  ready();

  async function emit(selector, event) {
    for (const callback of element(selector).handlers[event] || []) {
      await callback();
    }
  }

  async function selectTopic(value) {
    element('#dropdownTopic').value = value;
    await emit('#dropdownTopic', 'onChange');
  }

  function fillRequired() {
    const values = {
      '#inputFullName': 'Offline Test',
      '#inputOfficeName': 'Test Office',
      '#inputEmail': 'test@example.invalid',
      '#inputPhone': '0501234567',
      '#inputDescription': 'Detailed offline test for the new support topic.'
    };
    for (const [selector, value] of Object.entries(values)) {
      element(selector).value = value;
    }
  }

  return { element, calls, selectTopic, fillRequired, emit };
}

test('page ready exposes AI agents immediately before Other', () => {
  const page = loadPage();
  const options = Array.from(page.element('#dropdownTopic').options, option => option.value);
  assert.equal(options.filter(value => value === 'סוכני AI').length, 1);
  assert.equal(options[options.indexOf('סוכני AI') + 1], 'אחר');
  assert.equal(options.length, 11);
  assert.equal(page.element('#dropdownSubtopic').collapsed, true);
  assert.equal(page.element('#dropdownSubtopic').required, false);
});

test('existing topics require a subtopic and submit its value when selected', async () => {
  const page = loadPage();
  page.fillRequired();
  await page.selectTopic('הפקת דוחות');
  assert.equal(page.element('#dropdownSubtopic').collapsed, false);
  assert.equal(page.element('#dropdownSubtopic').required, true);
  await page.emit('#buttonSubmit', 'onClick');
  assert.equal(page.calls.length, 0);
  assert.equal(page.element('#dropdownSubtopic').focused, true);
  page.element('#dropdownSubtopic').value = 'נתון שגוי בדוח';
  await page.emit('#buttonSubmit', 'onClick');
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].submissions.find(entry => entry.label === 'תת-נושא').value, 'נתון שגוי בדוח');
});

test('AI agents submit without a subtopic or conditional detail', async () => {
  const page = loadPage();
  page.fillRequired();
  await page.selectTopic('סוכני AI');
  assert.equal(page.element('#dropdownSubtopic').collapsed, true);
  assert.equal(page.element('#dropdownSubtopic').required, false);
  assert.equal(page.element('#dropdownDetail').collapsed, true);
  const rejection = [];
  page.element('#dropdownSubtopic').validate('', value => rejection.push(value));
  assert.equal(rejection.length, 0);
  await page.emit('#buttonSubmit', 'onClick');
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].submissions.find(entry => entry.label === 'נושא הבעיה').value, 'סוכני AI');
  assert.equal(page.calls[0].submissions.some(entry => entry.label === 'תת-נושא'), false);
  assert.equal(page.calls[0].submissions.some(entry => entry.label === 'איזה דוח?'), false);
  assert.equal(page.element('#groupConfirm').collapsed, false);
});

test('switching from a populated topic to AI agents clears stale classification', async () => {
  const page = loadPage();
  page.fillRequired();
  await page.selectTopic('הפקת דוחות');
  page.element('#dropdownSubtopic').value = 'נתון שגוי בדוח';
  page.element('#dropdownDetail').value = 'דוח תקופתי';
  await page.selectTopic('סוכני AI');
  assert.equal(page.element('#dropdownSubtopic').value, undefined);
  assert.equal(page.element('#dropdownSubtopic').options.length, 0);
  assert.equal(page.element('#dropdownDetail').value, undefined);
  assert.equal(page.element('#dropdownDetail').options.length, 0);
  await page.emit('#buttonSubmit', 'onClick');
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].submissions.some(entry => entry.value === 'נתון שגוי בדוח'), false);
  assert.equal(page.calls[0].submissions.some(entry => entry.value === 'דוח תקופתי'), false);
});

test('switching back from AI agents restores the existing subtopic requirement', async () => {
  const page = loadPage();
  page.fillRequired();
  await page.selectTopic('סוכני AI');
  await page.selectTopic('תקלה במערכת');
  assert.equal(page.element('#dropdownSubtopic').collapsed, false);
  assert.equal(page.element('#dropdownSubtopic').required, true);
  assert.equal(page.element('#dropdownSubtopic').options.length, 3);
  await page.emit('#buttonSubmit', 'onClick');
  assert.equal(page.calls.length, 0);
  const rejections = [];
  page.element('#dropdownSubtopic').validate('', value => rejections.push(value));
  assert.equal(rejections.length, 1);
  page.element('#dropdownSubtopic').value = 'איטיות בביצועים';
  await page.emit('#buttonSubmit', 'onClick');
  assert.equal(page.calls.length, 1);
});
