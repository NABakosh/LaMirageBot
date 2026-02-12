// Reminder Service для автоматической отправки напоминаний о записях
// Отправляет напоминания клиентам и мастерам за 24 часа, 6 часов и 1 час до записи

const cron = require('node-cron');
const { Pool } = require('pg');

// Константы для временных окон напоминаний (в минутах)
const REMINDER_WINDOWS = {
  DAY_BEFORE: { min: 1425, max: 1455 },    // 24 часа ± 15 минут
  SIX_HOURS: { min: 345, max: 375 },       // 6 часов ± 15 минут
  ONE_HOUR: { min: 45, max: 75 }           // 1 час ± 15 минут
};

// Шаблоны сообщений для клиентов
const CLIENT_MESSAGE_TEMPLATES = {
  DAY_BEFORE: (booking) => 
    `🤍 Напоминаем о вашей записи завтра!\n\n` +
    `📋 Услуга: ${booking.service}\n` +
    `👤 Мастер: ${booking.master}\n` +
    `📅 Дата: ${formatDate(booking.date)}\n` +
    `🕐 Время: ${booking.time}\n` +
    `📍 Адрес: ${booking.salon_address}\n\n` +
    `Ждём вас в ${booking.salon_name}! ✨\n\n` +
    `Если нужно перенести или отменить запись, пожалуйста, сообщите нам заранее.`,
    
  SIX_HOURS: (booking) =>
    `✨ Напоминание: через 6 часов у вас запись!\n\n` +
    `📋 ${booking.service}\n` +
    `👤 Мастер: ${booking.master}\n` +
    `🕐 Время: ${booking.time}\n` +
    `📍 ${booking.salon_address}\n\n` +
    `До встречи! 🤍`,
    
  ONE_HOUR: (booking) =>
    `⏰ Через час у вас запись!\n\n` +
    `📋 ${booking.service}\n` +
    `👤 Мастер: ${booking.master}\n` +
    `🕐 Время: ${booking.time}\n` +
    `📍 ${booking.salon_address}\n\n` +
    `Уже готовимся вас встретить! ✨`
};

// Шаблоны сообщений для мастеров
const MASTER_MESSAGE_TEMPLATES = {
  DAY_BEFORE: (booking) =>
    `📋 Напоминание о записи завтра\n\n` +
    `👤 Клиент: ${booking.client_name}\n` +
    `📞 Телефон: ${booking.client_phone}\n` +
    `📋 Услуга: ${booking.service}\n` +
    `📅 Дата: ${formatDate(booking.date)}\n` +
    `🕐 Время: ${booking.time}\n` +
    `⏱️ Длительность: ${booking.duration} мин\n` +
    `💰 Цена: ${booking.price} тг`,
    
  SIX_HOURS: (booking) =>
    `⏰ Через 6 часов запись:\n\n` +
    `👤 ${booking.client_name}\n` +
    `📋 ${booking.service}\n` +
    `🕐 ${booking.time}\n` +
    `⏱️ ${booking.duration} мин`,
    
  ONE_HOUR: (booking) =>
    `🔔 Через час запись!\n\n` +
    `👤 ${booking.client_name}\n` +
    `📞 ${booking.client_phone}\n` +
    `📋 ${booking.service}\n` +
    `🕐 ${booking.time}`
};

// Форматирование даты для отображения
function formatDate(dateString) {
  const date = new Date(dateString);
  const options = { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' };
  return date.toLocaleDateString('ru-RU', options);
}

// Основной класс сервиса напоминаний
class ReminderService {
  constructor(pool, sock, masterContacts, config) {
    this.pool = pool;
    this.sock = sock;
    this.masterContacts = masterContacts;
    this.config = config;
    this.isRunning = false;
  }

  // Запуск cron job (каждые 15 минут)
  start() {
    if (this.isRunning) {
      console.log('⚠️ Reminder service уже запущен');
      return;
    }

    console.log('🔔 Запуск сервиса напоминаний...');
    console.log('📅 Расписание: каждые 15 минут');
    
    // Запускаем cron job: каждые 15 минут
    this.cronJob = cron.schedule('*/15 * * * *', async () => {
      await this.checkAndSendReminders();
    });

    this.isRunning = true;
    console.log('✅ Сервис напоминаний запущен');
    
    // Сразу делаем первую проверку
    this.checkAndSendReminders();
  }

  // Остановка сервиса
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      console.log('🛑 Сервис напоминаний остановлен');
    }
  }

  // Основная функция проверки и отправки напоминаний
  async checkAndSendReminders() {
    try {
      console.log('\n🔍 Проверка напоминаний...', new Date().toISOString());
      
      // Получаем все записи, которым нужны напоминания
      const bookings = await this.getBookingsNeedingReminders();
      
      if (bookings.length === 0) {
        console.log('ℹ️ Нет записей, требующих напоминаний');
        return;
      }

      console.log(`📧 Найдено ${bookings.length} записей для отправки напоминаний`);

      // Обрабатываем каждую запись
      for (const booking of bookings) {
        await this.processBookingReminders(booking);
      }

      console.log('✅ Проверка напоминаний завершена\n');
    } catch (error) {
      console.error('❌ Ошибка при проверке напоминаний:', error);
    }
  }

  // Получение записей, которым нужны напоминания
  async getBookingsNeedingReminders() {
    try {
      const now = new Date();
      
      const result = await this.pool.query(`
        SELECT 
          b.id,
          b.client_name,
          b.client_phone,
          b.user_id,
          b.service,
          b.master,
          b.price,
          b.date,
          b.time,
          b.duration,
          EXTRACT(EPOCH FROM (b.date + b.time::time - $1::timestamp)) / 60 AS minutes_until
        FROM bookings b
        WHERE b.status = 'confirmed'
          AND b.date >= CURRENT_DATE
          AND (b.date + b.time::time) > $1::timestamp
          AND (b.date + b.time::time) < ($1::timestamp + INTERVAL '25 hours')
        ORDER BY b.date, b.time
      `, [now]);

      return result.rows;
    } catch (error) {
      console.error('❌ Ошибка получения записей:', error);
      return [];
    }
  }

  // Обработка напоминаний для одной записи
  async processBookingReminders(booking) {
    const minutesUntil = parseFloat(booking.minutes_until);
    
    // Определяем какие напоминания нужно отправить
    const remindersToSend = [];
    
    if (minutesUntil >= REMINDER_WINDOWS.DAY_BEFORE.min && 
        minutesUntil <= REMINDER_WINDOWS.DAY_BEFORE.max) {
      remindersToSend.push({ type: '24h', clientType: 'client_24h', masterType: 'master_24h' });
    }
    
    if (minutesUntil >= REMINDER_WINDOWS.SIX_HOURS.min && 
        minutesUntil <= REMINDER_WINDOWS.SIX_HOURS.max) {
      remindersToSend.push({ type: '6h', clientType: 'client_6h', masterType: 'master_6h' });
    }
    
    if (minutesUntil >= REMINDER_WINDOWS.ONE_HOUR.min && 
        minutesUntil <= REMINDER_WINDOWS.ONE_HOUR.max) {
      remindersToSend.push({ type: '1h', clientType: 'client_1h', masterType: 'master_1h' });
    }

    // Отправляем напоминания
    for (const reminder of remindersToSend) {
      await this.sendClientReminder(booking, reminder.type, reminder.clientType);
      await this.sendMasterReminder(booking, reminder.type, reminder.masterType);
    }
  }

  // Отправка напоминания клиенту
  async sendClientReminder(booking, reminderType, dbReminderType) {
    try {
      // Проверяем, не отправляли ли уже это напоминание
      const existingReminder = await this.pool.query(
        'SELECT id FROM reminders WHERE booking_id = $1 AND reminder_type = $2 AND recipient_phone = $3',
        [booking.id, dbReminderType, booking.client_phone]
      );

      if (existingReminder.rows.length > 0) {
        console.log(`ℹ️ Напоминание ${reminderType} клиенту ${booking.client_name} уже отправлено`);
        return;
      }

      // Формируем сообщение
      const templateKey = reminderType === '24h' ? 'DAY_BEFORE' : 
                          reminderType === '6h' ? 'SIX_HOURS' : 'ONE_HOUR';
      
      const message = CLIENT_MESSAGE_TEMPLATES[templateKey]({
        ...booking,
        salon_name: this.config.SALON_NAME,
        salon_address: this.config.SALON_ADDRESS
      });

      // Отправляем WhatsApp сообщение
      const clientJid = booking.user_id;
      await this.sock.sendMessage(clientJid, { text: message });

      // Записываем в базу данных
      await this.pool.query(
        `INSERT INTO reminders (booking_id, reminder_type, recipient_phone, status)
         VALUES ($1, $2, $3, 'sent')`,
        [booking.id, dbReminderType, booking.client_phone]
      );

      console.log(`✅ Отправлено напоминание ${reminderType} клиенту ${booking.client_name} (запись #${booking.id})`);
    } catch (error) {
      console.error(`❌ Ошибка отправки напоминания клиенту:`, error);
      
      // Записываем ошибку в базу
      await this.pool.query(
        `INSERT INTO reminders (booking_id, reminder_type, recipient_phone, status, error_message)
         VALUES ($1, $2, $3, 'failed', $4)`,
        [booking.id, dbReminderType, booking.client_phone, error.message]
      );
    }
  }

  // Отправка напоминания мастеру
  async sendMasterReminder(booking, reminderType, dbReminderType) {
    try {
      const masterContact = this.masterContacts[booking.master];
      
      if (!masterContact || !masterContact.phone) {
        console.log(`⚠️ Нет контакта для мастера ${booking.master}`);
        return;
      }

      const masterPhone = masterContact.phone;

      // Проверяем, не отправляли ли уже это напоминание
      const existingReminder = await this.pool.query(
        'SELECT id FROM reminders WHERE booking_id = $1 AND reminder_type = $2 AND recipient_phone = $3',
        [booking.id, dbReminderType, masterPhone]
      );

      if (existingReminder.rows.length > 0) {
        console.log(`ℹ️ Напоминание ${reminderType} мастеру ${booking.master} уже отправлено`);
        return;
      }

      // Формируем сообщение
      const templateKey = reminderType === '24h' ? 'DAY_BEFORE' : 
                          reminderType === '6h' ? 'SIX_HOURS' : 'ONE_HOUR';
      
      const message = MASTER_MESSAGE_TEMPLATES[templateKey](booking);

      // Отправляем WhatsApp сообщение (форматируем номер для Baileys)
      const masterJid = `${masterPhone}@c.us`;
      await this.sock.sendMessage(masterJid, { text: message });

      // Записываем в базу данных
      await this.pool.query(
        `INSERT INTO reminders (booking_id, reminder_type, recipient_phone, status)
         VALUES ($1, $2, $3, 'sent')`,
        [booking.id, dbReminderType, masterPhone]
      );

      console.log(`✅ Отправлено напоминание ${reminderType} мастеру ${booking.master} (запись #${booking.id})`);
    } catch (error) {
      console.error(`❌ Ошибка отправки напоминания мастеру:`, error);
      
      // Записываем ошибку в базу
      const masterPhone = this.masterContacts[booking.master]?.phone || 'unknown';
      await this.pool.query(
        `INSERT INTO reminders (booking_id, reminder_type, recipient_phone, status, error_message)
         VALUES ($1, $2, $3, 'failed', $4)`,
        [booking.id, dbReminderType, masterPhone, error.message]
      );
    }
  }
}

module.exports = ReminderService;
