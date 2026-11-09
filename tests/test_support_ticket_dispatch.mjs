// Uses Node's ES module sandbox: node --experimental-vm-modules --test tests/test_support_ticket_dispatch.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function environment() {
  const records = new Map(), items = new Map(), cached = new Map();
  const emails = [], requests = [], alerts = [], links = [], logs = [];
  const faults = { lostResponse: 0, failedSave: 0, hideItems: false, failedRead: false, failedInsert: false, email: false };
  const clock = { value: Date.UTC(2026, 8, 15, 9) };
  const candidates = { items: [], cursor: null };
  const copy = value => value == null ? value : structuredClone(value);
  const data = {
    async get(collection, id, options) {
      assert.equal(collection, 'SupportTicketDispatches');
      assert.equal(options.suppressAuth, true); assert.equal(options.consistentRead, true);
      if (faults.failedRead) throw new Error('Read unavailable');
      return copy(records.get(id)) || null;
    },
    async insert(collection, item, options) {
      assert.equal(collection, 'SupportTicketDispatches'); assert.equal(options.suppressAuth, true);
      if (faults.failedInsert) throw new Error('Permission denied');
      if (records.has(item._id)) { const e = new Error('WD_ITEM_ALREADY_EXISTS'); e.code = 'WDE0074'; throw e; }
      records.set(item._id, copy(item)); return copy(item);
    },
    async update(collection, item, options) {
      assert.equal(collection, 'SupportTicketDispatches'); assert.equal(options.suppressAuth, true);
      assert.ok(records.has(item._id));
      if (item.kind === 'ticket' && item.status === 'created' && faults.failedSave > 0) {
        faults.failedSave--; throw new Error('Persisting result failed');
      }
      records.set(item._id, copy(item)); return copy(item);
    }
  };
  const fetch = async (url, init) => {
    assert.equal(url, 'https://api.monday.com/v2'); assert.equal(init.headers.Authorization, 'test-token');
    const { query, variables } = JSON.parse(init.body), key = init.headers['Idempotency-Key'];
    requests.push({query, variables, key}); let result;
    if (query.includes('FindServiceTicket')) {
      assert.equal(variables.params.rules[0].column_id, 'numeric_mm59qx9e');
      assert.equal(variables.params.rules[0].operator, 'any_of');
      const number = variables.params.rules[0].compare_value[0];
      const found = faults.hideItems ? [] : [...items.values()].filter(x => x.number === number).slice(0,2);
      result = { boards: [{ items_page: { items: found.map(x => ({id:x.id})) } }] };
    } else if (query.includes('mutation CreateServiceTicket')) {
      assert.match(key, /^support-ticket:/);
      const old = cached.get(key);
      if (old && clock.value - old.time < 1800000) {
        assert.equal(JSON.stringify(variables), old.request);
        result = old.result;
      } else {
        const columns = JSON.parse(variables.columnValues);
        const item = { id: String(100000 + items.size), number: Number(columns.numeric_mm59qx9e), columns, name: variables.itemName };
        items.set(item.id, item); result = { create_item: {id:item.id, name:item.name} };
        cached.set(key, { time:clock.value, request:JSON.stringify(variables), result });
        if (faults.lostResponse > 0) { faults.lostResponse--; throw new Error('Response lost AFTER creation'); }
      }
    } else if (query.includes('FindCustomerCandidates')) {
      assert.equal(variables.params.operator, 'or');
      result = {boards:[{items_page:copy(candidates)}]};
    } else if (query.includes('mutation CreateCustomerLinkAlert')) {
      alerts.push(copy(variables)); result = {create_update:{id:String(alerts.length)}};
    } else if (query.includes('mutation LinkCustomer')) {
      links.push(copy(variables)); result = {change_multiple_column_values:{id:String(variables.itemId)}};
    } else throw new Error('Unexpected GraphQL: '+query);
    return {ok:true,status:200,async json(){return {data:result};}};
  };
  const contacts = { queryContacts() { return {
    eq(key,value) {assert.equal(key,'primaryInfo.email');assert.equal(value,'supportclient@plan-t.org.il');return this;},
    limit(value){assert.equal(value,2);return this;}, async find(){return {items:[{_id:'support-contact'}]};}
  };} };
  const triggeredEmails = {async emailContact(template,contact,options){
    emails.push({template,contact,options:copy(options)}); if(faults.email) throw new Error('Email response lost');
  }};
  const context = vm.createContext({
    console:Object.fromEntries(['log','warn','error'].map(level=>[level,(...args)=>logs.push({level,args})])),
    Date:class extends Date {static now(){return clock.value;}}
  });
  const modules = new Map();
  function mock(name,values){modules.set(name,new vm.SyntheticModule(Object.keys(values),function(){
    for(const [key,value] of Object.entries(values)) this.setExport(key,value);
  },{context}));}
  mock('wix-data',{default:data}); mock('wix-fetch',{fetch});
  mock('wix-secrets-backend',{getSecret:async()=>'test-token'});
  mock('wix-crm-backend',{contacts,triggeredEmails});
  const helper = new vm.SourceTextModule(await readFile(new URL('../backend/supportTicketDispatch.js', import.meta.url),'utf8'),{context});
  modules.set('backend/supportTicketDispatch',helper);
  const action = new vm.SourceTextModule(await readFile(new URL('../monday_ticket.js', import.meta.url),'utf8'),{context});
  await action.link(name=>{assert.ok(modules.has(name));return modules.get(name);}); await action.evaluate();
  return {invoke:action.namespace.invoke,helper:helper.namespace,data,records,items,emails,requests,alerts,links,logs,faults,clock,candidates};
}
function payload(id='test-submission-001') {return {
  submissionId:id,contactId:'customer-contact',
  submissions:[
    ['שם מלא','בדיקת מערכת'],['שם המשרד','משרד בדיקה'],['מייל','support-test@example.invalid'],
    ['טלפון','0501234567'],['נושא הבעיה','פורטל לקוחות'],['תת-נושא','לקוח קצה לא מצליח להתחבר'],
    ['תיאור התקלה','בדיקה מדומה של פתיחת קריאה ללא שליחה אמיתית'],
    ['קישור למסך שבו נתקלתם בבעיה (URL)','https://www.plan-t.org.il/support']
  ].map(([label,value])=>({label,value}))
};}
function customer(id,email,phone){return {id,column_values:[{id:'contact_email',text:email},{id:'contact_phone',text:phone}]};}

test('Correct mapping: one ticket, two emails',async()=>{
  const e=await environment();await e.invoke({payload:payload()});
  assert.equal(e.items.size,1);assert.equal(e.emails.length,2);
  const item=[...e.items.values()][0];
  assert.deepEqual(item.columns.color_mm4ze6f3, { index: 19 });
  assert.equal(item.columns.dropdown_mm5qsryr.ids[0],6);assert.equal(item.columns.dropdown_mm5q7p43.ids[0],20);
  assert.equal(item.columns.phone_mm4zny3f.phone,'+972501234567');
  assert.equal(item.name,'פורטל לקוחות · לקוח קצה לא מצליח להתחבר · משרד בדיקה');
  assert.match(String(item.number),/^\d{8}$/);assert.equal((await e.helper.getDispatch('test-submission-001',e.data)).status,'completed');
});
test('Eight sequential invocations: one item and one set of effects',async()=>{
  const e=await environment();for(let i=0;i<8;i++)await e.invoke({payload:payload()});
  assert.equal(e.items.size,1);assert.equal(e.emails.length,2);assert.equal(e.alerts.length,1);
  assert.equal(e.requests.filter(r=>r.query.includes('CreateServiceTicket')).length,1);
});
test('Eight concurrent invocations: one item and one set of effects',async()=>{
  const e=await environment();await Promise.all(Array.from({length:8},()=>e.invoke({payload:payload()})));
  assert.equal(e.items.size,1);assert.equal(e.emails.length,2);assert.equal(e.alerts.length,1);
  assert.equal((await e.helper.getDispatch('test-submission-001',e.data)).status,'completed');
});
test('Distinct submission IDs remain distinct tickets',async()=>{
  const e=await environment();await Promise.all(['first','second'].map(id=>e.invoke({payload:payload(id)})));
  assert.equal(e.items.size,2);assert.equal(e.emails.length,4);assert.equal(new Set([...e.items.values()].map(x=>x.number)).size,2);
});
test('Lost response is recovered without another create request',async()=>{
  const e=await environment();e.faults.lostResponse=1;
  await assert.rejects(e.invoke({payload:payload()}),/AFTER/);assert.equal(e.items.size,1);assert.equal(e.emails.length,0);
  await e.invoke({payload:payload()});assert.equal(e.items.size,1);assert.equal(e.emails.length,2);
  assert.equal(e.requests.filter(r=>r.query.includes('CreateServiceTicket')).length,1);
});
test('Lost response plus stale lookup uses identical idempotency key and body',async()=>{
  const e=await environment();e.faults.lostResponse=1;await assert.rejects(e.invoke({payload:payload()}));
  e.faults.hideItems=true;const altered=payload();altered.submissions.find(x=>x.label==='שם המשרד').value='altered retry';
  await e.invoke({payload:altered});assert.equal(e.items.size,1);
  const creates=e.requests.filter(r=>r.query.includes('CreateServiceTicket'));assert.equal(creates.length,2);
  assert.equal(creates[0].key,creates[1].key);assert.equal(JSON.stringify(creates[0].variables),JSON.stringify(creates[1].variables));
});
test('Failed CMS persistence after creation is recovered',async()=>{
  const e=await environment();e.faults.failedSave=1;await assert.rejects(e.invoke({payload:payload()}),/Persisting/);
  await e.invoke({payload:payload()});assert.equal(e.items.size,1);assert.equal(e.emails.length,2);
});
test('Expired uncertain creation is never blindly retried',async()=>{
  const e=await environment();e.faults.lostResponse=1;await assert.rejects(e.invoke({payload:payload()}));
  e.clock.value+=31*60000;e.faults.hideItems=true;await assert.rejects(e.invoke({payload:payload()}),/verify ticket/);
  assert.equal(e.items.size,1);assert.equal(e.requests.filter(r=>r.query.includes('CreateServiceTicket')).length,1);
});
test('Lost response is recoverable after 24 hours',async()=>{
  const e=await environment();e.faults.lostResponse=1;await assert.rejects(e.invoke({payload:payload()}));
  e.clock.value+=86400000;await e.invoke({payload:payload()});assert.equal(e.items.size,1);assert.equal(e.emails.length,2);
});
test('Completed submission remains deduplicated after a year',async()=>{
  const e=await environment();await e.invoke({payload:payload()});e.clock.value+=365*86400000;
  await e.invoke({payload:payload()});assert.equal(e.items.size,1);assert.equal(e.emails.length,2);
});
test('Missing ID fails before any mutation',async()=>{
  const e=await environment();const p=payload();delete p.submissionId;
  await assert.rejects(e.invoke({payload:p}),/submissionId/);assert.equal(e.requests.length,0);assert.equal(e.records.size,0);
});
test('CMS failures do not masquerade as successful deduplication',async()=>{
  const e=await environment();e.faults.failedRead=true;await assert.rejects(e.invoke({payload:payload()}),/Read unavailable/);
  e.faults.failedRead=false;e.faults.failedInsert=true;await assert.rejects(e.invoke({payload:payload()}),/Permission denied/);
  assert.equal(e.items.size,0);assert.equal(e.emails.length,0);
});
test('Legacy ticket number collision advances to a free number',async()=>{
  const probe=await environment();await probe.invoke({payload:payload()});const number=[...probe.items.values()][0].number;
  const e=await environment();e.items.set('legacy',{id:'90000',number});await e.invoke({payload:payload()});
  assert.equal(e.items.size,2);assert.equal((await e.helper.getDispatch('test-submission-001',e.data)).ticketNumber,number+1);
});
test('Ambiguous existing ticket numbers stop processing',async()=>{
  const e=await environment();e.faults.lostResponse=1;await assert.rejects(e.invoke({payload:payload()}));
  e.items.set('duplicate',{...[...e.items.values()][0],id:'90001'});
  await assert.rejects(e.invoke({payload:payload()}),/Multiple Monday items/);assert.equal(e.emails.length,0);
});
test('Targeted customer lookup preserves exact normalized matching',async()=>{
  const e=await environment();e.candidates.items=[customer('80000','SUPPORT-TEST@EXAMPLE.INVALID','050-123-4567'),customer('80001','another@example.invalid','0508884567')];
  await e.invoke({payload:payload()});assert.equal(e.links.length,1);
  assert.equal(JSON.parse(e.links[0].columnValues).board_relation_mm5ajg15.item_ids[0],80000);
  assert.equal(e.requests.find(r=>r.query.includes('FindCustomerCandidates')).variables.params.rules[1].compare_value[0],'4567');
});
test('Conflicting customer identities are not linked',async()=>{
  const e=await environment();e.candidates.items=[customer('80000','support-test@example.invalid','0500000000'),customer('80001','another@example.invalid','0501234567')];
  await e.invoke({payload:payload()});assert.equal(e.links.length,0);assert.equal(e.alerts.length,1);assert.match(e.alerts[0].body,/שונים/);
});
test('Incomplete customer result set fails closed',async()=>{
  const e=await environment();e.candidates.cursor='more';e.candidates.items=[customer('80000','support-test@example.invalid','0501234567')];
  await e.invoke({payload:payload()});assert.equal(e.links.length,0);assert.equal(e.alerts.length,1);assert.equal(e.items.size,1);
});
test('Ambiguous email responses do not resend or recreate',async()=>{
  const e=await environment();e.faults.email=true;await e.invoke({payload:payload()});await e.invoke({payload:payload()});
  assert.equal(e.items.size,1);assert.equal(e.emails.length,2);
});
test('Abandoned side effect claim is flagged without a resend',async()=>{
  const e=await environment();let count=0;const now=()=>e.clock.value;
  await assert.rejects(e.helper.runDispatchStepOnce('fixture','customer-email',async()=>{count++;throw new Error('ambiguous');},e.data,now));
  e.clock.value+=240000;
  const result=await e.helper.runDispatchStepOnce('fixture','customer-email',async()=>{count++;},e.data,now);
  assert.equal(count,1);assert.equal(result.status,'needs_review');
});
test('Board queries are filtered and bounded',async()=>{
  const e=await environment();await e.invoke({payload:payload()});
  const queries=e.requests.filter(r=>r.query.includes('items_page'));assert.equal(queries.length,2);
  for(const r of queries){assert.ok(r.variables.params.rules.length);assert.match(r.query,/items_page\(limit: (2|100), query_params: \$params\)/);}
  assert.equal(e.requests.some(r=>r.query.includes('next_items_page')),false);
});
