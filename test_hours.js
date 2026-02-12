const CONFIG = {
	WORKING_HOURS_START: 10,
	WORKING_HOURS_END: 21,
}

console.log('Testing Business Hours Logic...')

// Test 1: Current Time
const now = new Date()
const almatyTime = new Date().toLocaleString("en-US", {timeZone: "Asia/Almaty"});
const almatyHour = new Date(almatyTime).getHours();

console.log('--------------------------------------------------')
console.log('Current System Time:', now.toString())
console.log('Almaty Hour:', almatyHour)

if (almatyHour < CONFIG.WORKING_HOURS_START || almatyHour >= CONFIG.WORKING_HOURS_END) {
    console.log("Status: CLOSED (Correct if it is currently night in Almaty)")
} else {
    console.log("Status: OPEN (Correct if it is currently day in Almaty)")
}
console.log('--------------------------------------------------')

// Test 2: Simulation of CLOSED hours (e.g. 05:00)
const simulatedClosedHour = 5;
console.log('Simulating 05:00 AM...')
if (simulatedClosedHour < CONFIG.WORKING_HOURS_START || simulatedClosedHour >= CONFIG.WORKING_HOURS_END) {
    console.log("Status: CLOSED (Pass)")
} else {
    console.log("Status: OPEN (Fail)")
}

// Test 3: Simulation of OPEN hours (e.g. 14:00)
const simulatedOpenHour = 14;
console.log('Simulating 14:00 PM...')
if (simulatedOpenHour < CONFIG.WORKING_HOURS_START || simulatedOpenHour >= CONFIG.WORKING_HOURS_END) {
    console.log("Status: CLOSED (Fail)")
} else {
    console.log("Status: OPEN (Pass)")
}
console.log('--------------------------------------------------')
