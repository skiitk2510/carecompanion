#!/usr/bin/env node
// Drives the demo beats through POST /api/agent on a running server and prints which brain and tools answered.
// Usage: node scripts/agent-smoke.mjs [base-url] [elder|caregiver]
const base = process.argv[2] ?? 'http://127.0.0.1:3000';
const speaker = process.argv[3] ?? 'elder';
const history = [];

async function say(utterance) {
  const res = await fetch(`${base}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ utterance, speaker, history }),
  });
  const json = await res.json();
  console.log(`\n> ${utterance}`);
  if (!res.ok) {
    console.log(`HTTP ${res.status}`, JSON.stringify(json));
    return;
  }
  const tools = json.toolCalls.map((t) => `${t.name}${t.isError ? ' (error)' : ''} ${t.ms}ms`).join(', ') || 'none';
  console.log(`[${json.brain}] tools: ${tools}`);
  console.log(json.reply);
  history.push({ role: 'user', text: utterance }, { role: 'assistant', text: json.reply });
}

console.log('status:', await (await fetch(`${base}/api/agent/status`)).text());
if (speaker === 'caregiver') {
  await say('How is Mom doing this week?');
} else {
  await say('What is my plan today?');
  await say('I took my blood pressure pill, the lisinopril');
  await say('Yes, record it anyway because Dr. Chen told me to double it today');
  await say("I'm feeling a bit dizzy this morning");
  await say('Help, I fell in the kitchen');
}
console.log('\nstatus:', await (await fetch(`${base}/api/agent/status`)).text());
