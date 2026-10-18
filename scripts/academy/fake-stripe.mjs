// A stand-in for Stripe, for the Academy browser test only (127.0.0.1).
//
// Implements exactly what the app calls — create/retrieve a Checkout Session
// and list its line items — plus a "pay" page the browser clicks through.
// Paying sends a REAL signed webhook (Stripe's own test signer, the app's
// webhook secret) to the app, so the app's signature check, routing and
// fulfilment all run for real. Control endpoints let the test replay an
// event, refund a payment, or hold the webhook back (to prove the return URL
// alone grants nothing and the confirm path asks Stripe).

import { createServer } from 'http'
import Stripe from 'stripe'

const PORT = Number(process.env.FAKE_STRIPE_PORT || 12111)
const APP = process.env.APP_URL || 'http://127.0.0.1:3200'
const SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_fixture'
const PRICES = { price_test_course: { amount: 1900, currency: 'usd' } }
const signer = new Stripe('sk_test_fixture_signer')

const sessions = new Map()
const events = []
let n = 0
let deliver = true

function parseForm(s) {
  const out = {}
  for (const [k, v] of new URLSearchParams(s)) {
    const parts = k.replace(/\]/g, '').split('[')
    let o = out
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ||= {}
    o[parts[parts.length - 1]] = v
  }
  return out
}
const body = req => new Promise(r => { let s = ''; req.on('data', c => s += c); req.on('end', () => r(s)) })
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

async function send(event) {
  const payload = JSON.stringify(event)
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: SECRET })
  const r = await fetch(`${APP}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload })
  return r.status
}
function event(type, object) {
  const e = { id: `evt_test_${++n}`, object: 'event', type, created: Math.floor(Date.now() / 1000), data: { object } }
  events.push(e)
  return e
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname

  if (p === '/v1/checkout/sessions' && req.method === 'POST') {
    const f = parseForm(await body(req))
    const price = f.line_items?.['0']?.price
    if (!PRICES[price]) return json(res, 400, { error: { type: 'invalid_request_error', message: `No such price: '${price}'` } })
    const id = `cs_test_${++n}${Math.random().toString(36).slice(2, 8)}`
    const s = {
      id, object: 'checkout.session', mode: f.mode, status: 'open', payment_status: 'unpaid',
      client_reference_id: f.client_reference_id || null, customer_email: f.customer_email || null, customer: null,
      metadata: f.metadata || {}, currency: PRICES[price].currency, amount_total: PRICES[price].amount,
      payment_intent: null, success_url: f.success_url, cancel_url: f.cancel_url, _price: price,
      url: `http://127.0.0.1:${PORT}/pay/${id}`,
    }
    sessions.set(id, s)
    return json(res, 200, s)
  }
  let m = /^\/v1\/checkout\/sessions\/([^/]+)(\/line_items)?$/.exec(p)
  if (m && req.method === 'GET') {
    const s = sessions.get(m[1])
    if (!s) return json(res, 404, { error: { type: 'invalid_request_error', message: 'No such checkout.session' } })
    if (m[2]) return json(res, 200, { object: 'list', has_more: false, data: [{ id: 'li_1', object: 'item', quantity: 1, price: { id: s._price } }] })
    return json(res, 200, s)
  }
  m = /^\/pay\/([^/]+)$/.exec(p)
  if (m && req.method === 'GET') {
    const s = sessions.get(m[1])
    res.writeHead(s ? 200 : 404, { 'content-type': 'text/html' })
    return res.end(s ? `<!doctype html><meta name=viewport content="width=device-width"><title>Fake Stripe Checkout</title>
      <h1>Fake Stripe Checkout</h1><p data-testid=amount>$${(s.amount_total / 100).toFixed(2)}</p>
      <form method=post><button id=pay>Pay</button></form><a href="${s.cancel_url}" id=cancel>Cancel</a>` : 'no such session')
  }
  if (m && req.method === 'POST') {
    const s = sessions.get(m[1])
    if (!s) return json(res, 404, {})
    s.status = 'complete'; s.payment_status = 'paid'; s.payment_intent = `pi_test_${++n}`
    if (deliver) await send(event('checkout.session.completed', { ...s }))
    res.writeHead(303, { location: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) })
    return res.end()
  }

  // ── control plane (test only) ──
  if (p === '/__control/deliver') { deliver = url.searchParams.get('on') !== '0'; return json(res, 200, { deliver }) }
  if (p === '/__control/replay-last') {
    const e = [...events].reverse().find(x => x.type === 'checkout.session.completed')
    return json(res, 200, { status: e ? await send(e) : null, id: e?.id })
  }
  if (p === '/__control/refund') {
    const pi = url.searchParams.get('pi')
    const status = await send(event('charge.refunded', { id: `ch_test_${++n}`, object: 'charge', payment_intent: pi, refunded: url.searchParams.get('partial') !== '1' }))
    return json(res, 200, { status })
  }
  if (p === '/__control/forged') {
    // A completed-checkout event with a bad signature.
    const e = event('checkout.session.completed', { id: 'cs_forged', mode: 'payment', payment_status: 'paid', metadata: { kind: 'academy_course' } })
    const r = await fetch(`${APP}/api/stripe/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' }, body: JSON.stringify(e) })
    return json(res, 200, { status: r.status })
  }
  if (p === '/__control/sessions') return json(res, 200, [...sessions.values()])
  json(res, 404, { error: { message: `fake stripe: ${req.method} ${p} not implemented` } })
}).listen(PORT, '127.0.0.1', () => console.log(`fake stripe on http://127.0.0.1:${PORT}`))
