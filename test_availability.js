
const dateStr = '2026-02-02';
const checkTimes = ['19:00', '20:00', '23:00', '23:30'];

console.log('--- Debugging Date Logic ---');
console.log('Process Timezone Offset:', new Date().getTimezoneOffset());
console.log('Current Time (new Date()):', new Date().toString());

const now = new Date(); // Simulating execution time
console.log('Now (ISO):', now.toISOString());

checkTimes.forEach(checkTime => {
    let normalizedTime = checkTime;
    if (normalizedTime.length > 5) normalizedTime = normalizedTime.substring(0, 5);
    
    // Logic from checkAvailability
    const bookingDateTime = new Date(`${dateStr}T${normalizedTime}:00`);
    
    console.log(`\nChecking time: ${checkTime}`);
    console.log(`Constructed Date String: ${dateStr}T${normalizedTime}:00`);
    console.log(`Booking Date Object: ${bookingDateTime.toString()}`);
    console.log(`Booking Date (ISO): ${bookingDateTime.toISOString()}`);
    
    if (bookingDateTime < now) {
        console.log(`RESULT: ⛔ PAST (${bookingDateTime.toLocaleTimeString()} < ${now.toLocaleTimeString()})`);
    } else {
        console.log(`RESULT: ✅ FUTURE (or present)`);
    }
});
