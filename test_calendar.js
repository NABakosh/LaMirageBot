// Quick test script for calendar integration
const { testCalendarConnection } = require('./calendar-service');

async function main() {
  console.log('Starting calendar connection test...\n');
  
  try {
    await testCalendarConnection();
    console.log('\n✅ Test completed');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main();
