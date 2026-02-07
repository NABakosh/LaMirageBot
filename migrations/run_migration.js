// Migration script: Add google_calendar_event_id to bookings table
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Running migration: add google_calendar_event_id...\n');
    
    // Add column
    await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS google_calendar_event_id VARCHAR(255)
    `);
    console.log('✅ Column google_calendar_event_id added');
    
    // Add index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_calendar_event 
      ON bookings(google_calendar_event_id)
    `);
    console.log('✅ Index idx_bookings_calendar_event created');
    
    // Add comment
    await client.query(`
      COMMENT ON COLUMN bookings.google_calendar_event_id IS 
      'ID события в Google Calendar (null если календарь не настроен для мастера)'
    `);
    console.log('✅ Column comment added');
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(console.error);
