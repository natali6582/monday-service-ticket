import wixData from 'wix-data';

const COLLECTION = 'SupportTicketDispatches';
// Monday retains idempotent responses for 30 minutes. Never recreate an
// uncertain request after that window; reconcile it against the board instead.
const SAFE_REPLAY_MS = 25 * 60 * 1000;

export function submissionIdFrom(payload) {
  const id = typeof payload?.submissionId === 'string' ? payload.submissionId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,90}$/.test(id)) {
    throw new Error('Missing or invalid Wix submissionId; Monday creation was not attempted');
  }
  return id;
}

async function getRecord(id, data) {
  return data.get(COLLECTION, id, { suppressAuth: true, consistentRead: true });
}

export async function getDispatch(id, data = wixData) {
  return getRecord(`ticket-${id}`, data);
}

async function insertOnce(item, data) {
  try {
    const record = await data.insert(COLLECTION, item, { suppressAuth: true });
    return { record, inserted: true };
  } catch (error) {
    // A failed read/write or permission error must never be treated as a lock.
    if (!String(error?.code || error?.message || '').match(/WDE0074|WD_ITEM_ALREADY_EXISTS/)) {
      throw error;
    }
    const record = await getRecord(item._id, data);
    if (!record) throw new Error(`Dispatch reservation not readable: ${item._id}`);
    return { record, inserted: false };
  }
}

export async function reserveTicketNumber(submissionId, findByNumber, data = wixData) {
  let hash = 2166136261;
  for (const char of submissionId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ticketNumber = 10000000 + ((hash + attempt) % 90000000);
    const id = `number-${ticketNumber}`;
    const reserved = await getRecord(id, data);
    if (reserved?.submissionId === submissionId) return ticketNumber;
    if (reserved || (await findByNumber(ticketNumber)).length) continue;
    const claim = await insertOnce({
      _id: id, title: id, kind: 'number', submissionId, ticketNumber
    }, data);
    if (claim.record.submissionId === submissionId) return ticketNumber;
  }
  throw new Error('Could not reserve a unique eight-digit ticket number');
}

export async function prepareDispatch(submissionId, ticketNumber, request, data = wixData, now = Date.now) {
  return insertOnce({
    _id: `ticket-${submissionId}`,
    title: submissionId,
    kind: 'ticket',
    submissionId,
    ticketNumber,
    request,
    status: 'prepared',
    startedAt: new Date(now())
  }, data);
}

function safeItemId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Monday returned an invalid item ID');
  return id;
}

export async function ensureTicketCreated(prepared, create, findByNumber, data = wixData, now = Date.now) {
  const { record, inserted } = prepared;
  if (record.itemId) return record;
  let itemId;
  if (!inserted) {
    const matches = await findByNumber(record.ticketNumber);
    if (matches.length > 1) throw new Error(`Multiple Monday items for ticket ${record.ticketNumber}; review required`);
    if (matches.length === 1) {
      // Ticket numbers are reserved atomically in this collection and checked
      // against legacy tickets before use. A retry can recover a lost response.
      itemId = safeItemId(matches[0].id);
    }
  }
  if (!itemId) {
    const age = now() - new Date(record.startedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= SAFE_REPLAY_MS) {
      console.error('Support ticket requires reconciliation; creation was not retried', {
        submissionId: record.submissionId, ticketNumber: record.ticketNumber
      });
      throw new Error(`Uncertain Monday creation for ${record.submissionId}; verify ticket ${record.ticketNumber} manually`);
    }
    itemId = safeItemId(await create(record.request, `support-ticket:${record.submissionId}`));
  }
  // Persist before any notification or customer-linking operation.
  return data.update(COLLECTION, { ...record, itemId, status: 'created' }, { suppressAuth: true });
}

export async function runDispatchStepOnce(submissionId, step, work, data = wixData, now = Date.now) {
  const id = `step-${submissionId}-${step}`;
  const claim = await insertOnce({
    _id: id, title: id, kind: 'step', submissionId, step,
    status: 'started', startedAt: new Date(now())
  }, data);
  if (!claim.inserted) {
    if (claim.record.status === 'done') return claim.record.result;
    // Triggered email APIs have no idempotency key. Do not send again after an
    // ambiguous result; keep the durable claim available for manual review.
    const status = now() - new Date(claim.record.startedAt).getTime() < 180000
      ? 'in_progress' : 'needs_review';
    console.warn('Support dispatch step already claimed', { submissionId, step, status });
    return { status };
  }
  let result;
  try {
    result = await work();
  } catch (error) {
    console.error('Support dispatch step requires review', { submissionId, step, error: error?.message });
    throw error;
  }
  await data.update(COLLECTION, { ...claim.record, status: 'done', result }, { suppressAuth: true });
  return result;
}

export async function completeDispatch(record, results, data = wixData) {
  const allSettled = results.every((result) => !['in_progress', 'needs_review'].includes(result?.status));
  if (!allSettled) return;
  await data.update(COLLECTION, { ...record, status: 'completed' }, { suppressAuth: true });
}
