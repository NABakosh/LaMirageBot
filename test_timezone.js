
const dateStr = '2026-02-02';
const timeStr = '19:00';
const offset = '+05:00';

console.log('--- Testing Constant Timezone Logic ---');
const now = new Date();
console.log('Now (Absolute):', now.toISOString());

const dateWithOffset = new Date(`${dateStr}T${timeStr}:00${offset}`);
console.log(`Constructed with offset (${offset}):`, dateWithOffset.toISOString());

if (dateWithOffset < now) {
    console.log('RESULT: ⛔ PAST (Correct for 19:00 KZ time vs 23:00 KZ time)');
} else {
    console.log('RESULT: ✅ FUTURE (Incorrect if late night)');
}

// Emulate UTC server environment check
// If we pretend now is UTC (server time might be just UTC representation of same moment)
// 11 PM KZ = 6 PM UTC (18:00)
// 19:00 KZ = 14:00 UTC
// 14:00 < 18:00 -> Past.

// But if we construct WITHOUT offset:
const dateNoOffset = new Date(`${dateStr}T${timeStr}:00`);
console.log('Constructed NO offset:', dateNoOffset.toISOString());
// In UTC env: 19:00 UTC.
// 19:00 > 18:00 -> Future. (This triggers the bug!)
