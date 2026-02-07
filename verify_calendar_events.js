// Финальная проверка интеграции календаря
require('dotenv').config();
const { google } = require('googleapis');
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fullCalendarCheck() {
  console.log('\n🔍 ПОЛНАЯ ПРОВЕРКА ИНТЕГРАЦИИ GOOGLE CALENDAR\n');
  console.log('='.repeat(60));
  
  try {
    // 1. Проверяем переменные окружения
    console.log('\n1️⃣ ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ:\n');
    console.log(`   CALENDAR_AIGERIM: ${process.env.CALENDAR_AIGERIM || '❌ НЕ УСТАНОВЛЕНО'}`);
    console.log(`   CALENDAR_YUNA: ${process.env.CALENDAR_YUNA || '❌ НЕ УСТАНОВЛЕНО'}`);
    
    // 2. Проверяем записи в БД
    console.log('\n2️⃣ ПРОВЕРКА ЗАПИСЕЙ В БАЗЕ ДАННЫХ:\n');
    const result = await pool.query(`
      SELECT id, client_name, master, service, date::text, time::text, duration, google_calendar_event_id
      FROM bookings
      WHERE id IN (10, 11)
      ORDER BY id
    `);
    
    for (const booking of result.rows) {
      console.log(`\n   📋 Запись #${booking.id}:`);
      console.log(`      Клиент: ${booking.client_name}`);
      console.log(`      Мастер: ${booking.master}`);
      console.log(`      Услуга: ${booking.service}`);
      console.log(`      Дата: ${booking.date}`);
      console.log(`      Время: ${booking.time}`);
      console.log(`      Длительность: ${booking.duration} мин`);
      console.log(`      Event ID: ${booking.google_calendar_event_id || '❌ НЕ СОЗДАНО'}`);
      
      // Проверка корректности
      if (booking.id === 10) {
        if (booking.date.includes('2026-02-07') && booking.time === '14:00:00') {
          console.log(`      ✅ ДАТА И ВРЕМЯ КОРРЕКТНЫ (7 фев 14:00)`);
        } else {
          console.log(`      ❌ НЕВЕРНАЯ ДАТА/ВРЕМЯ`);
        }
      }
      
      if (booking.id === 11) {
        if (booking.date.includes('2026-02-08') && booking.time === '17:00:00') {
          console.log(`      ✅ ДАТА И ВРЕМЯ КОРРЕКТНЫ (8 фев 17:00)`);
        } else {
          console.log(`      ❌ НЕВЕРНАЯ ДАТА/ВРЕМЯ`);
        }
        
        if (!booking.google_calendar_event_id) {
          console.log(`      ⚠️  Календарь не создан - бот был запущен до обновления .env`);
        }
      }
    }
    
    // 3. Проверяем события в Google Calendar
    console.log('\n3️⃣ ПРОВЕРКА СОБЫТИЙ В GOOGLE CALENDAR:\n');
    
    const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    
    const calendar = google.calendar({ version: 'v3', auth });
    
    for (const booking of result.rows) {
      if (!booking.google_calendar_event_id) {
        console.log(`\n   ⏭️  Пропускаем запись #${booking.id} (нет event ID)`);
        continue;
      }
      
      const calendarEmail = booking.master === 'Айгерим' 
        ? process.env.CALENDAR_AIGERIM 
        : process.env.CALENDAR_YUNA;
      
      if (!calendarEmail) {
        console.log(`\n   ⏭️  Пропускаем запись #${booking.id} (календарь не настроен)`);
        continue;
      }
      
      try {
        const event = await calendar.events.get({
          calendarId: calendarEmail,
          eventId: booking.google_calendar_event_id,
        });
        
        console.log(`\n   ✅ Событие найдено для записи #${booking.id}:`);
        console.log(`      Название: ${event.data.summary}`);
        console.log(`      Начало: ${event.data.start.dateTime}`);
        console.log(`      Конец: ${event.data.end.dateTime}`);
        console.log(`      Календарь: ${calendarEmail}`);
        
        // Парсим дату из события
        const eventStart = new Date(event.data.start.dateTime);
        const expectedDate = new Date(booking.date);
        const [hours, minutes] = booking.time.split(':');
        
        expectedDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        if (eventStart.getDate() === expectedDate.getDate() &&
            eventStart.getMonth() === expectedDate.getMonth() &&
            eventStart.getFullYear() === expectedDate.getFullYear() &&
            eventStart.getHours() === parseInt(hours) &&
            eventStart.getMinutes() === parseInt(minutes)) {
          console.log(`      ✅ ДАТА И ВРЕМЯ В КАЛЕНДАРЕ СОВПАДАЮТ С БД`);
        } else {
          console.log(`      ❌ НЕСОВПАДЕНИЕ:`);
          console.log(`         Ожидалось: ${expectedDate.toLocaleString('ru-RU')}`);
          console.log(`         В календаре: ${eventStart.toLocaleString('ru-RU')}`);
        }
        
      } catch (error) {
        console.log(`\n   ❌ Ошибка получения события #${booking.id}: ${error.message}`);
      }
    }
    
    // Итоговый вывод
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 ИТОГОВЫЙ РЕЗУЛЬТАТ:\n');
    
    const booking10 = result.rows.find(b => b.id === 10);
    const booking11 = result.rows.find(b => b.id === 11);
    
    if (booking10 && booking10.google_calendar_event_id) {
      console.log('   ✅ Запись #10 (Айгерим, 7 фев 14:00) - в календаре');
    } else {
      console.log('   ❌ Запись #10 - проблема с календарем');
    }
    
    if (booking11 && booking11.google_calendar_event_id) {
      console.log('   ✅ Запись #11 (Юна, 8 фев 17:00) - в календаре');
    } else {
      console.log('   ⚠️  Запись #11 - НЕ в календаре (перезапустите бота!)');
    }
    
    console.log('\n');
    
  } catch (error) {
    console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
  } finally {
    await pool.end();
  }
}

fullCalendarCheck();
