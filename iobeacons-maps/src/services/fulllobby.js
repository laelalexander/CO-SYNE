import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, q } from '../db/pool.js';

// Sends website inquiries to Fulllobby so its operators can pick them up.
// Each inquiry is one signed JSON POST. The result is stored on the message
// so the admin console shows what was delivered and can send it again.
export const fulllobbyReady = () => Boolean(config.fulllobbyUrl);

export function inquiryPayload(m) {
  return {
    type: 'inquiry', source: 'iobeacons.com', id: String(m.id),
    name: m.name, email: m.email, company: m.company || null, topic: m.topic || 'General',
    message: m.message, page: m.page || null, created_at: m.created_at,
    console_url: `${config.publicUrl}/console/#inquiries/${m.id}`,
  };
}

export async function forwardInquiry(id) {
  const m = await one('select * from contact_messages where id=$1', [id]);
  if (!m) return { ok: false, error: 'Inquiry not found.' };
  if (!fulllobbyReady()) {
    await q("update contact_messages set forward_status='Fulllobby is not connected yet' where id=$1", [id]);
    return { ok: false, error: 'Fulllobby is not connected yet.' };
  }
  const body = JSON.stringify(inquiryPayload(m));
  const sig = crypto.createHmac('sha256', config.fulllobbyKey || '').update(body).digest('hex');
  let result;
  try {
    const res = await fetch(config.fulllobbyUrl, {
      method: 'POST', body,
      headers: {
        'Content-Type': 'application/json', 'User-Agent': config.userAgent, 'X-IoBeacons-Signature': `sha256=${sig}`,
        ...(config.fulllobbyKey ? { Authorization: `Bearer ${config.fulllobbyKey}` } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });
    result = res.ok ? { ok: true } : { ok: false, error: `Fulllobby answered ${res.status}` };
  } catch (e) {
    result = { ok: false, error: `Couldn't reach Fulllobby: ${e.name === 'TimeoutError' ? 'timed out' : e.message}` };
  }
  if (result.ok) await q("update contact_messages set forwarded_at=now(), forward_status='Sent to Fulllobby', status=case when status='new' then 'forwarded' else status end, updated_at=now() where id=$1", [id]);
  else await q('update contact_messages set forward_status=$2 where id=$1', [id, result.error]);
  return result;
}
