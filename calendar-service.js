// Google Calendar Integration для La Mirage Beauty
// Использует Service Account для создания событий в календарях мастеров

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Маппинг мастеров на их календари
// Только Юна получает события в свой личный календарь
// Остальные мастера не получают календарные события
const MASTER_CALENDARS = {
  'Айгерим': null,
  'Юна': process.env.CALENDAR_YUNA || null,
  'Аружан': null,
  'Гульназ': null,
  'Жазира': null,
  'Лена': null,
};

// Инициализация Google Calendar API клиента
let calendarClient = null;

/**
 * Инициализирует Google Calendar API клиент с service account
 */
async function initCalendarClient() {
  if (calendarClient) {
    return calendarClient;
  }

  try {
    const credentialsPath = process.env.GOOGLE_CALENDAR_CREDENTIALS || './credentials.json';
    
    if (!fs.existsSync(credentialsPath)) {
      console.warn('⚠️ Файл credentials.json не найден. Google Calendar интеграция отключена.');
      return null;
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    calendarClient = google.calendar({ version: 'v3', auth });
    console.log('✅ Google Calendar API клиент инициализирован');
    
    return calendarClient;
  } catch (error) {
    console.error('❌ Ошибка инициализации Google Calendar API:', error.message);
    return null;
  }
}

/**
 * Получает email календаря для мастера
 * @param {string} masterName - Имя мастера
 * @returns {string|null} - Email календаря или null
 */
function getCalendarEmail(masterName) {
  const email = MASTER_CALENDARS[masterName];
  
  if (!email) {
    console.log(`ℹ️ Календарь для мастера "${masterName}" не настроен. Пропускаем.`);
    return null;
  }
  
  return email;
}

/**
 * Форматирует дату и время в RFC3339 формат для Google Calendar
 * @param {string} date - Дата в формате YYYY-MM-DD
 * @param {string} time - Время в формате HH:MM
 * @param {number} durationMinutes - Длительность в минутах
 * @returns {Object} - Объект с start и end в RFC3339 формате
 */
function formatDateTime(date, time, durationMinutes = 60) {
  // Казахстан - UTC+5 (Алматы)
  const timezone = 'Asia/Almaty';
  const timezoneOffset = '+05:00';
  
  // Создаем ISO строку с явным указанием временной зоны (RFC3339)
  const startDateTime = `${date}T${time}:00${timezoneOffset}`;
  
  // Вычисляем время окончания
  const startDateObj = new Date(startDateTime);
  const endDateObj = new Date(startDateObj.getTime() + durationMinutes * 60000);
  
  // Форматируем дату окончания в формат YYYY-MM-DD
  const endYear = endDateObj.getFullYear();
  const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
  const endDay = String(endDateObj.getDate()).padStart(2, '0');
  const endHours = String(endDateObj.getHours()).padStart(2, '0');
  const endMinutes = String(endDateObj.getMinutes()).padStart(2, '0');
  
  const endDateTime = `${endYear}-${endMonth}-${endDay}T${endHours}:${endMinutes}:00${timezoneOffset}`;
  
  return {
    start: {
      dateTime: startDateTime,
      timeZone: timezone,
    },
    end: {
      dateTime: endDateTime,
      timeZone: timezone,
    },
  };
}

/**
 * Добавляет событие в Google Calendar
 * @param {Object} booking - Объект с данными бронирования
 * @returns {Promise<string|null>} - ID созданного события или null при ошибке
 */
async function addToCalendar(booking) {
  const {
    id,
    client_name,
    client_phone,
    service,
    master,
    price,
    date,
    time,
    duration = 60,
  } = booking;

  try {
    // Получаем email календаря мастера
    const calendarEmail = getCalendarEmail(master);
    
    if (!calendarEmail) {
      console.log(`ℹ️ Google Calendar не настроен для мастера "${master}". Бронирование #${id} создано без календаря.`);
      return null;
    }

    // Инициализируем клиент
    const calendar = await initCalendarClient();
    
    if (!calendar) {
      console.warn('⚠️ Google Calendar API не доступен. Пропускаем создание события.');
      return null;
    }

    // Форматируем дату и время
    const { start, end } = formatDateTime(date, time, duration);

    // Создаем описание события
    const description = [
      `📋 Услуга: ${service}`,
      `💰 Цена: ${price} тг`,
      `⏱️ Длительность: ${duration} мин`,
      `📞 Телефон: ${client_phone}`,
      `🆔 Запись #${id}`,
    ].join('\n');

    // Создаем событие
    const event = {
      summary: `${client_name} - ${service}`,
      description: description,
      start: start,
      end: end,
      location: process.env.SALON_ADDRESS || 'La Mirage Beauty',
      colorId: '9', // Синий цвет для бронирований
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 24 * 60 }, // За 1 день
          { method: 'popup', minutes: 60 },      // За 1 час
        ],
      },
    };

    console.log(`📅 Создаем событие в календаре ${calendarEmail} для бронирования #${id}...`);

    const response = await calendar.events.insert({
      calendarId: calendarEmail,
      resource: event,
    });

    const eventId = response.data.id;
    console.log(`✅ Событие создано в Google Calendar: ${eventId}`);
    console.log(`   📧 Календарь: ${calendarEmail}`);
    console.log(`   👤 Клиент: ${client_name}`);
    console.log(`   📅 Дата: ${date} ${time}`);

    return eventId;

  } catch (error) {
    console.error(`❌ Ошибка создания события в Google Calendar для бронирования #${id}:`, error.message);
    
    // Детальная информация об ошибке
    if (error.response) {
      console.error('   Статус:', error.response.status);
      console.error('   Данные:', error.response.data);
    }
    
    // Не прерываем процесс бронирования при ошибке календаря
    return null;
  }
}

/**
 * Удаляет событие из Google Calendar
 * @param {string} eventId - ID события в Google Calendar
 * @param {string} masterName - Имя мастера (для определения календаря)
 * @returns {Promise<boolean>} - true если удалено, false при ошибке
 */
async function removeFromCalendar(eventId, masterName) {
  if (!eventId) {
    console.log('ℹ️ Event ID не указан, пропускаем удаление из календаря');
    return false;
  }

  try {
    const calendarEmail = getCalendarEmail(masterName);
    
    if (!calendarEmail) {
      console.log(`ℹ️ Календарь для мастера "${masterName}" не настроен`);
      return false;
    }

    const calendar = await initCalendarClient();
    
    if (!calendar) {
      console.warn('⚠️ Google Calendar API не доступен');
      return false;
    }

    console.log(`🗑️ Удаляем событие ${eventId} из календаря ${calendarEmail}...`);

    await calendar.events.delete({
      calendarId: calendarEmail,
      eventId: eventId,
    });

    console.log(`✅ Событие ${eventId} удалено из Google Calendar`);
    return true;

  } catch (error) {
    console.error(`❌ Ошибка удаления события ${eventId} из Google Calendar:`, error.message);
    return false;
  }
}

/**
 * Тестирует подключение к Google Calendar API
 * @returns {Promise<boolean>}
 */
async function testCalendarConnection() {
  console.log('\n🔍 Тестирование подключения к Google Calendar API...\n');

  try {
    const calendar = await initCalendarClient();
    
    if (!calendar) {
      console.error('❌ Не удалось инициализировать Calendar API клиент');
      return false;
    }

    // Проверяем доступ к календарям мастеров
    for (const [masterName, calendarEmail] of Object.entries(MASTER_CALENDARS)) {
      if (!calendarEmail) {
        console.log(`⚠️ Календарь для "${masterName}" не настроен (пропущено)`);
        continue;
      }

      console.log(`\nПроверка календаря для "${masterName}" (${calendarEmail})...`);

      try {
        const response = await calendar.calendars.get({
          calendarId: calendarEmail,
        });

        console.log(`✅ Доступ к календаря "${masterName}" успешен`);
        console.log(`   Название: ${response.data.summary}`);
        console.log(`   Временная зона: ${response.data.timeZone}`);

      } catch (error) {
        console.error(`❌ Ошибка доступа к календарю "${masterName}":`, error.message);
        
        if (error.code === 404) {
          console.error(`   💡 Убедитесь что email правильный: ${calendarEmail}`);
        } else if (error.code === 403) {
          console.error(`   💡 Сервисный аккаунт не имеет доступа к календарю ${calendarEmail}`);
          console.error(`   💡 Добавьте lamirageintegration@integration-481605.iam.gserviceaccount.com`);
          console.error(`      как редактора календаря в Google Calendar`);
        }
      }
    }

    console.log('\n✅ Тестирование завершено\n');
    return true;

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
    return false;
  }
}

module.exports = {
  addToCalendar,
  removeFromCalendar,
  testCalendarConnection,
};
