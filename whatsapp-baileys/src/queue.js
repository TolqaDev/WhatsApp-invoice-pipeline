/**
 * Fatura Bot — Mesaj kuyruğu yönetimi.
 * Eşzamanlı işleme limiti ve kuyruk taşması kontrolü sağlar.
 */

const MAX_QUEUE = 10;
const MAX_CONCURRENT = 3;
const QUEUE_WARN_COOLDOWN = 30_000;

let activeCount = 0;
const queue = [];
let lastQueueWarnAt = 0;

const processedIds = new Set();
const MAX_PROCESSED_IDS = 500;

let processCallback = null;

export function setProcessCallback(cb) {
  processCallback = cb;
}

export function trackMessageId(id) {
  if (processedIds.has(id)) return false;
  processedIds.add(id);
  if (processedIds.size > MAX_PROCESSED_IDS) {
    const iter = processedIds.values();
    const removeCount = Math.floor(MAX_PROCESSED_IDS * 0.2);
    for (let i = 0; i < removeCount; i++) {
      processedIds.delete(iter.next().value);
    }
  }
  return true;
}

export function drainQueue() {
  while (queue.length > 0 && activeCount < MAX_CONCURRENT) {
    const next = queue.shift();
    console.log(
      `[Queue] ▶ Kuyruktan alındı — MsgID: ${next.msg.key.id}, ` +
      `kuyruk: ${queue.length}, aktif: ${activeCount + 1}/${MAX_CONCURRENT}`,
    );
    if (processCallback) processCallback(next.msg, next.sock);
  }
}

export function enqueue(msg, sock) {
  queue.push({ msg, sock });
  console.log(
    `[Queue] 📥 Kuyruğa eklendi — MsgID: ${msg.key.id}, ` +
    `kuyruk: ${queue.length}/${MAX_QUEUE}, aktif: ${activeCount}/${MAX_CONCURRENT}`,
  );
}

export function isQueueFull() {
  return queue.length >= MAX_QUEUE;
}

export function isBusy() {
  return activeCount >= MAX_CONCURRENT;
}

export function incrementActive() {
  activeCount++;
}

export function decrementActive() {
  activeCount--;
}

export function getActiveCount() {
  return activeCount;
}

export function getQueueLength() {
  return queue.length;
}

export function shouldWarnQueueFull() {
  const now = Date.now();
  if (now - lastQueueWarnAt > QUEUE_WARN_COOLDOWN) {
    lastQueueWarnAt = now;
    return true;
  }
  return false;
}

export { MAX_QUEUE, MAX_CONCURRENT };

