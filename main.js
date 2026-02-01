// WhatsApp Bot для салона красоты La Mirage Beauty
// npm install @whiskeysockets/baileys qrcode-terminal @google/generative-ai googleapis dotenv pg pino @hapi/boom

require('dotenv').config()
const makeWASocket = require('@whiskeysockets/baileys').default
const { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const { VertexAI } = require('@google-cloud/vertexai')
const { google } = require('googleapis')
const { Pool } = require('pg')
const cron = require('node-cron')
const fs = require('fs')
const P = require('pino')

// ===================== ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК =====================
// Обработчик необработанных ошибок для Baileys
process.on('unhandledRejection', (reason, promise) => {
	const errorMessage = reason?.message || String(reason)
	
	// Логируем ошибки но не падаем
	console.error('⚠️  Необработанная ошибка Promise:', errorMessage)
	console.error('Детали:', reason?.stack || reason)
})

// ===================== КОНФИГУРАЦИЯ =====================
const CONFIG = {
	VERTEX_PROJECT_ID: process.env.VERTEX_PROJECT_ID || 'lamirage',
	VERTEX_LOCATION: process.env.VERTEX_LOCATION || 'us-central1',
	VERTEX_KEY_FILE: process.env.VERTEX_KEY_FILE || './vertex_key.json',
	GOOGLE_CALENDAR_CREDENTIALS:
		process.env.GOOGLE_CALENDAR_CREDENTIALS || './credentials.json',
	CALENDAR_ID: process.env.CALENDAR_ID || 'primary',
	ADMIN_WHITELIST: process.env.ADMIN_WHITELIST
		? process.env.ADMIN_WHITELIST.split(',').map(n => n.trim())
		: [],
	SALON_NAME: process.env.SALON_NAME || 'La Mirage Beauty',
	INSTAGRAM_LINK: process.env.INSTAGRAM_LINK || '',
	SALON_ADDRESS: process.env.SALON_ADDRESS || '',
	WORKING_HOURS: process.env.WORKING_HOURS || 'Ежедневно с 10:00 до 21:00',
	NODE_ENV: process.env.NODE_ENV || 'development',
	DATABASE_URL:
		process.env.DATABASE_URL || 'postgresql://localhost:5432/lamiragebeauty',
}

// Валидация конфигурации
// Валидация конфигурации
function validateConfig() {
	const required = ['VERTEX_PROJECT_ID', 'VERTEX_KEY_FILE', 'DATABASE_URL']
	const missing = required.filter(key => !CONFIG[key])

	if (missing.length > 0) {
		console.error('❌ Отсутствуют обязательные переменные:', missing.join(', '))
		process.exit(1)
	}

	console.log('\n📋 КОНФИГУРАЦИЯ БОТА:')
	console.log(`Салон: ${CONFIG.SALON_NAME}`)
	console.log(`Администраторы: ${CONFIG.ADMIN_WHITELIST.length} человек`)
	CONFIG.ADMIN_WHITELIST.forEach((admin, i) => {
		console.log(`   ${i + 1}. ${admin}`)
	})
	console.log('')

	if (CONFIG.ADMIN_WHITELIST.length === 0) {
		console.warn(
			'⚠️  ADMIN_WHITELIST пуст. Добавьте номера администраторов в .env'
		)
	}
}

// ===================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================
// Извлечение номера телефона из Baileys JID формата
async function extractPhoneNumber(jid, message = null) {
	// Baileys использует @s.whatsapp.net для обычных чатов
	// Убираем суффиксы и возвращаем чистый номер
	if (typeof jid === 'string') {
		return jid.replace(/@.*$/, '')
	}
	return jid
}

// ===================== ФУНКЦИИ ДЛЯ РАБОТЫ С ДАТАМИ =====================
function getToday() {
	const today = new Date()
	const year = today.getFullYear()
	const month = String(today.getMonth() + 1).padStart(2, '0')
	const day = String(today.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function getTomorrow() {
	const tomorrow = new Date()
	tomorrow.setDate(tomorrow.getDate() + 1)
	const year = tomorrow.getFullYear()
	const month = String(tomorrow.getMonth() + 1).padStart(2, '0')
	const day = String(tomorrow.getDate()).padStart(2, '0')
	return `${year}-${month}-${day}`
}

function formatDateForDisplay(dateString) {
	const date = new Date(dateString)
	const options = { day: 'numeric', month: 'long', year: 'numeric' }
	return date.toLocaleDateString('ru-RU', options)
}

function getDayOfWeek(dateString) {
	const date = new Date(dateString)
	const days = [
		'воскресенье',
		'понедельник',
		'вторник',
		'среда',
		'четверг',
		'пятница',
		'суббота',
	]
	return days[date.getDay()]
}

function getNextDays(count = 7) {
	const dates = []
	for (let i = 0; i < count; i++) {
		const date = new Date()
		date.setDate(date.getDate() + i)
		const year = date.getFullYear()
		const month = String(date.getMonth() + 1).padStart(2, '0')
		const day = String(date.getDate()).padStart(2, '0')
		const formatted = `${year}-${month}-${day}`
		const dayName = getDayOfWeek(formatted)
		const displayDate = formatDateForDisplay(formatted)

		dates.push({
			date: formatted,
			display: displayDate,
			dayName: dayName,
			isToday: i === 0,
			isTomorrow: i === 1,
		})
	}
	return dates
}

// ===================== STAGE GUARDS (State Machine Protection) =====================
const VALID_STAGES = [
	'greeting',
	'asking_name_and_phone',
	'asking_phone_only',
	'conversation',
	'awaiting_confirmation'
];

const VALID_TRANSITIONS = {
	'greeting': ['asking_name_and_phone'],
	'asking_name_and_phone': ['asking_phone_only', 'conversation'],
	'asking_phone_only': ['conversation'],
	'conversation': ['conversation', 'greeting', 'awaiting_confirmation'],
	'awaiting_confirmation': ['conversation', 'greeting']
};

function canTransition(from, to) {
	if (!VALID_STAGES.includes(to)) {
		console.error(`❌ [STAGE_GUARD] Invalid target stage: ${to}`);
		return false;
	}
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

function assertStageInvariants(conversation) {
	const { stage, client_name, client_phone, booking_data } = conversation;
	
	// Conversation stage requires both name and phone
	if (stage === 'conversation' && (!client_name || !client_phone)) {
		const missing = [];
		if (!client_name) missing.push('name');
		if (!client_phone) missing.push('phone');
		console.error(`❌ [INVARIANT_VIOLATION] stage=conversation requires: ${missing.join(', ')}`);
		return { valid: false, code: 'INVARIANT_CONVERSATION_INCOMPLETE', missing };
	}
	
	// asking_phone_only requires name
	if (stage === 'asking_phone_only' && !client_name) {
		console.error(`❌ [INVARIANT_VIOLATION] stage=asking_phone_only requires name`);
		return { valid: false, code: 'INVARIANT_PHONE_STAGE_NO_NAME' };
	}
	
	// awaiting_confirmation requires pending_booking data (FIXED: correct field path)
	if (stage === 'awaiting_confirmation' && !booking_data?.pending_booking) {
		console.error(`❌ [INVARIANT_VIOLATION] stage=awaiting_confirmation requires booking_data.pending_booking`);
		return { valid: false, code: 'INVARIANT_CONFIRM_NO_BOOKING' };
	}
	
	return { valid: true };
}

// Safe stage transition with validation
function safeStageTransition(conversation, newStage, userId) {
	const oldStage = conversation.stage;
	
	if (!canTransition(oldStage, newStage)) {
		console.error(`❌ [STAGE_GUARD] Blocked transition: ${oldStage} → ${newStage} for user ${userId}`);
		return { 
			success: false, 
			code: 'INVALID_STAGE_TRANSITION',
			from: oldStage,
			to: newStage
		};
	}
	
	conversation.stage = newStage;
	console.log(`🔄 [STAGE] ${oldStage} → ${newStage} for user ${userId}`);
	return { success: true };
}

// ===================== REJECTION CODES (Structured Logging) =====================
const REJECTION_CODES = {
	RATE_LIMIT_EXCEEDED: { code: 'E001', severity: 'warning', admin_action: false },
	SLOT_BUSY: { code: 'E002', severity: 'info', admin_action: false },
	VALIDATION_FAILED: { code: 'E003', severity: 'warning', admin_action: true },
	PAST_DATE: { code: 'E004', severity: 'info', admin_action: false },
	PAST_TIME: { code: 'E005', severity: 'info', admin_action: false },
	MASTER_NOT_FOUND: { code: 'E006', severity: 'error', admin_action: true },
	INVARIANT_VIOLATION: { code: 'E007', severity: 'critical', admin_action: true },
	DUPLICATE_BOOKING: { code: 'E008', severity: 'info', admin_action: false },
	OUTSIDE_WORKING_HOURS: { code: 'E009', severity: 'info', admin_action: false },
	CLIENT_CONFLICT: { code: 'E010', severity: 'info', admin_action: false },
	INCOMPLETE_DATA: { code: 'E011', severity: 'warning', admin_action: false },
};

async function logRejection(pool, userId, code, details = {}) {
	try {
		const rejection = REJECTION_CODES[code];
		const logEntry = {
			code,
			rejection_code: rejection?.code || 'E999',
			severity: rejection?.severity || 'unknown',
			...details,
			timestamp: new Date().toISOString()
		};
		
		await pool.query(
			`INSERT INTO booking_logs (booking_id, action, details, user_id)
			 VALUES (NULL, $1, $2, $3)`,
			['rejection', JSON.stringify(logEntry), userId]
		);
		
		console.log(`❌ [${rejection?.code || 'E999'}] ${code}: ${JSON.stringify(details)}`);
		
		return rejection;
	} catch (error) {
		console.error('Error logging rejection:', error);
		return null;
	}
}

// ===================== IDEMPOTENCY KEY (Duplicate Protection) =====================
const crypto = require('crypto');

function generateIdempotencyKey(userId, master, date, time, service) {
	const data = `${userId}:${master}:${date}:${time}:${service}`;
	return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

// ===================== CONFIRMATION DETECTION (Phase 4) =====================
const CONFIRMATION_KEYWORDS = [
	'да', 'yes', 'ок', 'ok', 'подтверждаю', 'подтвердить', 'верно', 
	'всё верно', 'все верно', 'правильно', 'согласен', 'согласна',
	'записывай', 'записывайте', 'бронируй', 'бронируйте', 'давай', 'давайте'
];

const DENIAL_KEYWORDS = [
	'нет', 'no', 'отмена', 'отменить', 'не надо', 'не нужно', 
	'неправильно', 'ошибка', 'изменить', 'другое', 'другой'
];

function isUserConfirmation(message) {
	const lower = message.toLowerCase().trim();
	// Use word-boundary matching to prevent false positives like "недавно" matching "да"
	const words = lower.split(/\s+/);
	return CONFIRMATION_KEYWORDS.some(keyword => words.includes(keyword));
}

function isUserDenial(message) {
	const lower = message.toLowerCase().trim();
	// Use word-boundary matching to prevent false positives like "другой мастер" matching "другой"
	const words = lower.split(/\s+/);
	return DENIAL_KEYWORDS.some(keyword => words.includes(keyword));
}

function formatBookingConfirmationMessage(bookingData, clientName) {
	return `📋 Проверьте данные записи:\n\n` +
		`📌 Услуга: ${bookingData.service}\n` +
		`👤 Мастер: ${bookingData.master}\n` +
		`💰 Цена: ${bookingData.price} тг\n` +
		`📅 Дата: ${formatDateForDisplay(bookingData.date)}\n` +
		`🕐 Время: ${bookingData.time}\n\n` +
		`${clientName}, всё верно?\n\n` +
		`✅ Напишите "да" или "подтверждаю"\n` +
		`❌ Если что-то не так — просто напишите что исправить`;
}

// ===================== ДАННЫЕ О САЛОНЕ (из main.js) =====================
const MASTERS = {
	mainMaster: 'Юна',
	secondaryMasters: ['Гульназ', 'Жазира', 'Айгерим', 'Аружан', 'Айлин'],
}

const PRICES = [
	{
		master: MASTERS.mainMaster,
		маникюр: 3000,
		'гель-покрытие': 7000,
		'наращивание ногтей типсами': 9000,
		'наращивание ногтей на верхние формы': 10000,
		'снятие покрытия': 1000,
		дизайн: 'от 1000',
	},
	{
		master: 'другие мастера',
		маникюр: 1000,
		'гель-покрытие': 3500,
		'наращивание ногтей': 5000,
		'снятие покрытия': 500,
		дизайн: 'от 500',
	},
]

// ===================== ДАННЫЕ О САЛОНЕ =====================
const SALON_DATA = {
	masters: [
		{
			name: 'Юна',
			specialty: 'главный мастер по маникюру',
			services: ['маникюр', 'наращивание'],
			priceCategory: 'premium',
		},
		{
			name: 'Аружан',
			specialty: 'мастер по маникюру',
			services: ['маникюр', 'наращивание'],
			priceCategory: 'standard',
		},
		{
			name: 'Айгерим',
			specialty: 'мастер по маникюру',
			services: ['маникюр', 'наращивание'],
			priceCategory: 'standard',
		},
		{
			name: 'Гульназ',
			specialty: 'мастер по маникюру',
			services: ['маникюр', 'наращивание'],
			priceCategory: 'standard',
		},
		{
			name: 'Жазира',
			specialty: 'мастер по маникюру',
			services: ['маникюр', 'наращивание'],
			priceCategory: 'standard',
		},
		{
			name: 'Лена',
			specialty: 'мастер по бровям, ресницам и шугарингу',
			services: ['брови', 'ресницы', 'шугаринг', 'ламинирование'],
			priceCategory: 'standard',
		},
	],

	services: [
		// УСЛУГИ ЮНЫ (МАНИКЮР)
		{
			name: 'Маникюр без покрытия',
			master: 'Юна',
			price: 3000,
			duration: 60,
			category: 'маникюр',
		},
		{
			name: 'Маникюр с укреплением',
			master: 'Юна',
			price: 7000,
			duration: 90,
			category: 'маникюр',
		},
		{
			name: 'Наращивание ногтей типсами',
			master: 'Юна',
			price: 9000,
			duration: 120,
			category: 'маникюр',
		},
		{
			name: 'Наращивание ногтей верхними формами',
			master: 'Юна',
			price: 10000,
			duration: 120,
			category: 'маникюр',
		},
		{
			name: 'Снятие покрытия',
			master: 'Юна',
			price: 1000,
			duration: 30,
			category: 'маникюр',
		},
		{
			name: 'Сложный дизайн',
			master: 'Юна',
			price: 1000,
			duration: 30,
			category: 'маникюр',
		},

		// УСЛУГИ ДРУГИХ МАСТЕРОВ (МАНИКЮР: Аружан, Айгерим, Гульназ, Жазира)
		{
			name: 'Маникюр без покрытия',
			master: 'другие',
			price: 1000,
			duration: 60,
			category: 'маникюр',
		},
		{
			name: 'Маникюр с укреплением',
			master: 'другие',
			price: 3500,
			duration: 90,
			category: 'маникюр',
		},
		{
			name: 'Наращивание ногтей',
			master: 'другие',
			price: 5000,
			duration: 120,
			category: 'маникюр',
		},
		{
			name: 'Снятие покрытия',
			master: 'другие',
			price: 500,
			duration: 30,
			category: 'маникюр',
		},
		{
			name: 'Дизайн',
			master: 'другие',
			price: 500,
			duration: 30,
			category: 'маникюр',
		},

		// НАРАЩИВАНИЕ РЕСНИЦ (ЛЕНА)
		{
			name: 'Наращивание ресниц Классика',
			master: 'Лена',
			price: 6000,
			duration: 120,
			category: 'ресницы',
		},
		{
			name: 'Наращивание ресниц 2Д-3Д',
			master: 'Лена',
			price: 7000,
			duration: 150,
			category: 'ресницы',
		},
		{
			name: 'Мокрый эффект до 3.5Д',
			master: 'Лена',
			price: 7000,
			duration: 150,
			category: 'ресницы',
		},
		{
			name: 'Мокрый эффект от 4Д',
			master: 'Лена',
			price: 8000,
			duration: 180,
			category: 'ресницы',
		},
		{
			name: 'Наращивание 4Д-5Д изгибы LM',
			master: 'Лена',
			price: 8000,
			duration: 180,
			category: 'ресницы',
		},
		{
			name: 'Снятие ресниц (чужое/своё без наращивания)',
			master: 'Лена',
			price: 1000,
			duration: 30,
			category: 'ресницы',
		},

		// ЛАМИНИРОВАНИЕ (ЛЕНА)
		{
			name: 'Ламинирование бровей (окрашивание + ботокс)',
			master: 'Лена',
			price: 5000,
			duration: 60,
			category: 'брови',
		},
		{
			name: 'Ламинирование ресниц (окрашивание + ботокс)',
			master: 'Лена',
			price: 5000,
			duration: 60,
			category: 'ресницы',
		},
		{
			name: 'Ламинирование бровей + ресниц',
			master: 'Лена',
			price: 8500,
			duration: 90,
			category: 'ресницы + брови',
		},

		// БРОВИ (ЛЕНА)
		{
			name: 'Коррекция бровей воск/пинцет',
			master: 'Лена',
			price: 1500,
			duration: 30,
			category: 'брови',
		},
		{
			name: 'Окрашивание бровей',
			master: 'Лена',
			price: 2000,
			duration: 30,
			category: 'брови',
		},

		// ШУГАРИНГ - КОМБО (ЛЕНА)
		{
			name: 'Шугаринг Комбо 1 (глубокое бикини + подмышки + ноги до колен)',
			master: 'Лена',
			price: 6000,
			duration: 90,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг Комбо 2 (руки полностью + ноги полностью)',
			master: 'Лена',
			price: 5000,
			duration: 90,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг Комбо 3 (глубокое бикини + подмышки)',
			master: 'Лена',
			price: 4500,
			duration: 60,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг Комбо 4 (глубокое бикини + подмышки + ноги полностью)',
			master: 'Лена',
			price: 7000,
			duration: 120,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг Комбо 5 (ноги до колен + руки до локтя + глубокое бикини + подмышки)',
			master: 'Лена',
			price: 7000,
			duration: 120,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг Комбо 6 (руки до локтя + ноги до колена)',
			master: 'Лена',
			price: 4000,
			duration: 75,
			category: 'шугаринг',
		},

		// ШУГАРИНГ - ОТДЕЛЬНЫЕ ЗОНЫ (ЛЕНА)
		{
			name: 'Шугаринг лицо полностью',
			master: 'Лена',
			price: 3500,
			duration: 30,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг лоб',
			master: 'Лена',
			price: 500,
			duration: 10,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг усики',
			master: 'Лена',
			price: 500,
			duration: 10,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг подбородок',
			master: 'Лена',
			price: 500,
			duration: 10,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг бакенбарды',
			master: 'Лена',
			price: 1000,
			duration: 15,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг затылок',
			master: 'Лена',
			price: 1000,
			duration: 15,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг спина',
			master: 'Лена',
			price: 1500,
			duration: 30,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг живот полностью',
			master: 'Лена',
			price: 1500,
			duration: 25,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг линия живота',
			master: 'Лена',
			price: 500,
			duration: 10,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг поясница',
			master: 'Лена',
			price: 1000,
			duration: 15,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг ягодицы',
			master: 'Лена',
			price: 1000,
			duration: 20,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг глубокое бикини',
			master: 'Лена',
			price: 4000,
			duration: 45,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг классическое бикини',
			master: 'Лена',
			price: 3000,
			duration: 30,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг подмышки',
			master: 'Лена',
			price: 1000,
			duration: 15,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг ноги полностью',
			master: 'Лена',
			price: 4000,
			duration: 60,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг ноги до колен',
			master: 'Лена',
			price: 3000,
			duration: 40,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг руки полностью',
			master: 'Лена',
			price: 3000,
			duration: 45,
			category: 'шугаринг',
		},
		{
			name: 'Шугаринг руки до локтя',
			master: 'Лена',
			price: 2500,
			duration: 30,
			category: 'шугаринг',
		},
	],

	materialInfo:
		'Мы работаем на профессиональных материалах премиум-класса: гель-лаки CND, Kodi, базы и топы Rubber Base. Все материалы гипоаллергенны и безопасны.',
	workingHours: CONFIG.WORKING_HOURS,
	address: CONFIG.SALON_ADDRESS,
}

// ===================== POSTGRESQL =====================
const pool = new Pool({
	connectionString: CONFIG.DATABASE_URL,
	ssl: false,
})

// Тест подключения
pool.on('connect', () => {
	console.log('✅ PostgreSQL подключен')
})

pool.on('error', err => {
	console.error('❌ Ошибка PostgreSQL:', err)
})
// Инициализация базы данных
async function initDatabase() {
	let client
	try {
		// Получаем клиента из пула
		client = await pool.connect()
		console.log('🔌 Подключение к PostgreSQL установлено')

		// Создание таблицы conversations
		await client.query(`
			CREATE TABLE IF NOT EXISTS conversations (
				user_id VARCHAR(255) PRIMARY KEY,
				stage VARCHAR(50) DEFAULT 'greeting',
				history JSONB DEFAULT '[]'::jsonb,
				booking_data JSONB DEFAULT '{}'::jsonb,
				client_name VARCHAR(255),
				client_phone VARCHAR(50),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`)
		console.log('✅ Таблица conversations создана')
		await client.query(`
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'is_admin_mode'
    ) THEN
      ALTER TABLE conversations ADD COLUMN is_admin_mode BOOLEAN DEFAULT FALSE;
    END IF;
  END $$;
`)
		await client.query(`
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'admin_chat_id'
    ) THEN
      ALTER TABLE conversations ADD COLUMN admin_chat_id VARCHAR(255);
    END IF;
  END $$;
`)
		console.log('✅ Столбец admin_chat_id проверен/добавлен')
		// Добавление столбца updated_at если его нет
		await client.query(`
  DO $$ 
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'conversations' AND column_name = 'updated_at'
    ) THEN
      ALTER TABLE conversations ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
  END $$;
`)
		console.log('✅ Столбец updated_at проверен/добавлен')

		// Добавление триггера для автообновления updated_at
		await client.query(`
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
  END;
  $$ language 'plpgsql';
`)

		await client.query(`
  DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
  
  CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`)
		console.log('✅ Триггер автообновления updated_at создан')
		// Создание таблицы bookings
		await client.query(`
			CREATE TABLE IF NOT EXISTS bookings (
				id SERIAL PRIMARY KEY,
				user_id VARCHAR(255) NOT NULL,
				client_name VARCHAR(255) NOT NULL,
				client_phone VARCHAR(50) NOT NULL,
				service VARCHAR(255) NOT NULL,
				master VARCHAR(100) NOT NULL,
				price INTEGER NOT NULL,
				date DATE NOT NULL,
				time TIME NOT NULL,
				status VARCHAR(50) DEFAULT 'pending',
				reminder_sent BOOLEAN DEFAULT FALSE,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				confirmed_at TIMESTAMP,
				completed_at TIMESTAMP
			);
		`)
		console.log('✅ Таблица bookings создана')

		await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 60;
    `)
		console.log('✅ Столбец duration добавлен в таблицу bookings')

		// Добавление столбцов для системы напоминаний
		await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS reminder_24h_sent BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS reminder_3h_sent BOOLEAN DEFAULT FALSE;
    `)
		console.log('✅ Столбцы reminder_24h_sent и reminder_3h_sent добавлены')

		// Добавление updated_at для idempotency
		await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `)

		// Создание таблицы логов для аудита
		await client.query(`
		CREATE TABLE IF NOT EXISTS booking_logs (
			id SERIAL PRIMARY KEY,
			booking_id INTEGER,
			action VARCHAR(50) NOT NULL,
			details JSONB,
			user_id VARCHAR(255),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
	`)
		console.log('✅ Таблица booking_logs создана')

		// Создание таблицы statistics
		await client.query(`
			CREATE TABLE IF NOT EXISTS statistics (
				master_name VARCHAR(100) PRIMARY KEY,
				total_bookings INT DEFAULT 0,
				confirmed_bookings INT DEFAULT 0,
				completed_bookings INT DEFAULT 0,
				revenue BIGINT DEFAULT 0,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`)
		console.log('✅ Таблица statistics создана')

		// Создание таблицы clients
		await client.query(`
			CREATE TABLE IF NOT EXISTS clients (
				phone VARCHAR(50) PRIMARY KEY,
				name VARCHAR(255),
				user_id VARCHAR(255),
				total_visits INT DEFAULT 0,
				total_spent BIGINT DEFAULT 0,
				last_visit TIMESTAMP,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
		`)
		console.log('✅ Таблица clients создана')

		// Создание индексов
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
			CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
			CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
			CREATE INDEX IF NOT EXISTS idx_bookings_reminder ON bookings(date, time, reminder_sent);
			CREATE INDEX IF NOT EXISTS idx_bookings_master_date ON bookings(master, date);
			CREATE INDEX IF NOT EXISTS idx_booking_logs_booking_id ON booking_logs(booking_id);
			CREATE INDEX IF NOT EXISTS idx_booking_logs_created_at ON booking_logs(created_at);
		`)
		console.log('✅ Индексы созданы')

		// Добавление столбца idempotency_key для защиты от дубликатов
		await client.query(`
			ALTER TABLE bookings 
			ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
		`)
		
		await client.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_idempotency 
			ON bookings(idempotency_key) 
			WHERE idempotency_key IS NOT NULL;
		`)
		console.log('✅ Столбец idempotency_key добавлен')

		// Создание таблицы intent_logs для отладки
		await client.query(`
			CREATE TABLE IF NOT EXISTS intent_logs (
				id SERIAL PRIMARY KEY,
				user_id VARCHAR(255),
				intent_type VARCHAR(50),
				intent_data JSONB,
				decision VARCHAR(50),
				reason_code VARCHAR(50),
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			);
			CREATE INDEX IF NOT EXISTS idx_intent_logs_user_created 
			ON intent_logs(user_id, created_at DESC);
		`)
		console.log('✅ Таблица intent_logs создана')

		// Добавление мастеров в статистику
		for (const master of SALON_DATA.masters) {
			await client.query(
				`INSERT INTO statistics (master_name, total_bookings, confirmed_bookings, revenue)
				VALUES ($1, 0, 0, 0) ON CONFLICT (master_name) DO NOTHING`,
				[master.name]
			)
		}
		console.log('✅ Мастера добавлены в статистику')

		console.log('✅ База данных PostgreSQL полностью инициализирована')
	} catch (error) {
		console.error('❌ Ошибка инициализации БД:', error.message)
		console.error('Детали:', error)
		throw error
	} finally {
		// Освобождаем клиента обратно в пул
		if (client) {
			client.release()
		}
	}
}

// ===================== СЕРВИСЫ =====================
let whatsappClient
let vertexAI
let generativeModel
let calendar

// Инициализация Vertex AI (замена Gemini для Казахстана)
function initVertexAI() {
	try {
		const fs = require('fs')
		const keyPath = CONFIG.VERTEX_KEY_FILE

		// Проверяем существование файла ключа
		if (!fs.existsSync(keyPath)) {
			throw new Error(
				`Файл ключа не найден: ${keyPath}\nСоздайте Service Account в Google Cloud и скачайте JSON ключ`
			)
		}

		// Читаем и проверяем содержимое
		const keyContent = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
		if (!keyContent.project_id || !keyContent.private_key) {
			throw new Error(
				'Невалидный формат файла ключа. Проверьте что это правильный Service Account JSON'
			)
		}

		// Устанавливаем переменную окружения для Google Auth
		process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath

		vertexAI = new VertexAI({
			project: CONFIG.VERTEX_PROJECT_ID,
			location: CONFIG.VERTEX_LOCATION,
		})

		generativeModel = vertexAI.getGenerativeModel({
			model: 'gemini-2.5-flash',
		})

		console.log('✅ Vertex AI инициализирован (US region, обход блокировки КЗ)')
		console.log(`   Project: ${CONFIG.VERTEX_PROJECT_ID}`)
		console.log(`   Location: ${CONFIG.VERTEX_LOCATION}`)
	} catch (error) {
		console.error('❌ Ошибка инициализации Vertex AI:', error.message)
		console.error(
			'\n💡 ИНСТРУКЦИЯ ПО ИСПРАВЛЕНИЮ:\n' +
				'1. Перейдите: https://console.cloud.google.com/\n' +
				'2. Включите Vertex AI API\n' +
				'3. Создайте Service Account с ролью "Vertex AI User"\n' +
				'4. Скачайте JSON ключ и сохраните как vertex_key.json\n' +
				'5. Убедитесь что файл находится в корне проекта\n'
		)
		throw error
	}
}
// Инициализация Google Calendar (из main.js - работает лучше)
async function initGoogleCalendar() {
	try {
		const auth = new google.auth.GoogleAuth({
			keyFile: CONFIG.GOOGLE_CALENDAR_CREDENTIALS,
			scopes: ['https://www.googleapis.com/auth/calendar'],
		})

		const authClient = await auth.getClient()
		calendar = google.calendar({ version: 'v3', auth: authClient })

		console.log('✅ Google Calendar инициализирован через Service Account')
	} catch (err) {
		console.error('❌ Ошибка инициализации Google Calendar:', err.message)
		console.log('ℹ️  Бот будет работать без интеграции с календарем')
	}
}

// Инициализация WhatsApp с Baileys
async function initWhatsApp() {
	try {
		console.log('⏳ Инициализация WhatsApp через Baileys...')
		
		// Загружаем состояние аутентификации
		const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
		
		// Получаем последнюю версию WhatsApp Web
		const { version } = await fetchLatestBaileysVersion()
		console.log(`📱 Используем WhatsApp Web версия: ${version.join('.')}`)
		
		// Создаем WhatsApp сокет
		const sock = makeWASocket({
			version,
			logger: P({ level: 'silent' }), // 'debug' для детальных логов
			printQRInTerminal: true,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' }))
			},
			getMessage: async (key) => {
				// Возвращаем пустое сообщение если не найдено
				return { conversation: '' }
			}
		})
		
		// Сохраняем глобальную ссылку
		whatsappClient = sock
		
		// Обработчик обновления креденшалов
		sock.ev.on('creds.update', saveCreds)
		
		// Обработчик обновлений соединения
		sock.ev.on('connection.update', async (update) => {
			const { connection, lastDisconnect, qr } = update
			
			// Отображаем QR код
			if (qr) {
				console.log('\n📱 Отсканируйте QR-код в WhatsApp:\n')
				qrcode.generate(qr, { small: true })
				console.log('\n💡 Откройте WhatsApp → Настройки → Связанные устройства → Связать устройство\n')
			}
			
			// Обработка закрытия соединения
			if (connection === 'close') {
				const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
				const statusCode = lastDisconnect?.error?.output?.statusCode
				
				console.log('⚠️  Соединение закрыто. Код:', statusCode)
				console.log('� Переподключение:', shouldReconnect)
				
				if (shouldReconnect) {
					console.log('⏳ Переподключаюсь через 3 секунды...')
					setTimeout(() => {
						initWhatsApp()
					}, 3000)
				} else {
					console.log('❌ Выход из WhatsApp. Удалите папку auth_info_baileys и перезапустите бота')
				}
			} 
			
			// Соединение установлено
			if (connection === 'open') {
				console.log('\n✅ WhatsApp бот запущен!')
				console.log(`📞 Салон: ${CONFIG.SALON_NAME}`)
				console.log(`👥 Администраторов: ${CONFIG.ADMIN_WHITELIST.length}\n`)
				console.log('🎉 Бот готов к работе! Можете отправлять сообщения.\n')
			}
		})
		
		// Обработчик входящих сообщений
		sock.ev.on('messages.upsert', async ({ messages, type }) => {
			if (type !== 'notify') return
			
			for (const msg of messages) {
				// Пропускаем служебные сообщения и свои собственные
				if (!msg.message || msg.key.fromMe) continue
				
				// Пропускаем групповые чаты
				if (msg.key.remoteJid.endsWith('@g.us')) continue
				
				try {
					await handleMessage(msg, sock)
				} catch (error) {
					console.error('❌ Ошибка обработки сообщения:', error)
				}
			}
		})
		
		return sock
		
	} catch (error) {
			console.error('❌ Ошибка инициализации WhatsApp:', error)
		throw error
	}
}

// ===================== ФУНКЦИИ ОТПРАВКИ СООБЩЕНИЙ (BAILEYS) =====================
// Отправка сообщения
async function sendMessage(sock, jid, text) {
	try {
		await sock.sendMessage(jid, { text })
	} catch (error) {
		console.error(`❌ Ошибка отправки сообщения в ${jid}:`, error.message)
		throw error
	}
}

// Ответ на сообщение
async function replyMessage(sock, msg, text) {
	try {
		await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
	} catch (error) {
		console.error(`❌ Ошибка ответа на сообщение:`, error.message)
		throw error
	}
}

// Извлечение текста сообщения из Baileys формата
function getMessageText(msg) {
	return msg.message?.conversation || 
	       msg.message?.extendedTextMessage?.text || 
	       msg.message?.imageMessage?.caption ||
	       msg.message?.videoMessage?.caption ||
	       ''
}

// ===================== ОБРАБОТКА СООБЩЕНИЙ =====================
// Простая валидация без AI (fallback)
function fallbackValidation(userMessage, dataType) {
	if (dataType === 'name') {
		const cleanName = userMessage.trim().split(/\s+/)[0]
		if (
			cleanName.length < 2 ||
			cleanName.startsWith('/') ||
			/^\d+$/.test(cleanName)
		) {
			return {
				isValid: false,
				data: null,
				message:
					'Пожалуйста, напишите ваше настоящее имя 😊'
			}
		}
		return { isValid: true, data: cleanName, message: null }
	} else if (dataType === 'phone') {
		const cleanPhone = userMessage.replace(/[^0-9+]/g, '').replace(/^8/, '7')
		if (cleanPhone.length < 10 || cleanPhone.length > 15) {
			return {
				isValid: false,
				data: null,
				message:
					'Пожалуйста, введите корректный номер телефона\n\nНапример:\n+7 706 424 0050\n77064240050',
			}
		}
		return { isValid: true, data: cleanPhone, message: null }
	}
	return { isValid: false, data: null, message: 'Ошибка валидации' }
}
// ===================== ВАЛИДАЦИЯ ЧЕРЕЗ GEMINI AI =====================
async function validateUserDataWithGemini(userMessage, dataType) {
	if (!generativeModel) {
		console.error('❌ Vertex AI не инициализирован, используем fallback')
		return fallbackValidation(userMessage, dataType)
	}
	try {
		let prompt = ''

		if (dataType === 'name') {
			prompt = `Проанализируй сообщение пользователя и определи, является ли это настоящим именем человека.

Сообщение: "${userMessage}"

ПРАВИЛА:
1. Это должно быть настоящее имя (например: Азат, Айгуль, Марат, Диана, Анна, John)
2. НЕ принимай: вопросы ("как дела", "что"), приветствия ("привет", "здравствуй"), команды, цифры
3. Извлеки только ПЕРВОЕ слово как имя, игнорируй остальное
4. Имя должно быть минимум 2 буквы

Ответь ТОЛЬКО в формате JSON:
{
  "isValid": true/false,
  "data": "извлеченное имя или null",
  "message": "сообщение для пользователя если невалидно, или null"
}

Примеры:
"Азат" -> {"isValid": true, "data": "Азат", "message": null}
"меня зовут Диана" -> {"isValid": true, "data": "Диана", "message": null}
"как дела" -> {"isValid": false, "data": null, "message": "Пожалуйста, напишите ваше настоящее имя 😊\\n\\nНапример: Азат, Айгуль, Марат, Диана"}
"привет" -> {"isValid": false, "data": null, "message": "Пожалуйста, напишите ваше имя, а не приветствие 😊"}
"123" -> {"isValid": false, "data": null, "message": "Пожалуйста, напишите ваше имя буквами"}`
		} else if (dataType === 'phone') {
			prompt = `Проанализируй сообщение и извлеки номер телефона.

Сообщение: "${userMessage}"

ПРАВИЛА:
1. Извлеки все цифры из сообщения
2. Номер должен быть от 10 до 15 цифр
3. Убери все символы кроме цифр и плюса в начале
4. Если номер начинается с 8, замени на 7

Ответь ТОЛЬКО в формате JSON:
{
  "isValid": true/false,
  "data": "очищенный номер или null",
  "message": "сообщение для пользователя если невалидно, или null"
}

Примеры:
"+7 706 424 0050" -> {"isValid": true, "data": "77064240050", "message": null}
"77064240050" -> {"isValid": true, "data": "77064240050", "message": null}
"8 706 424 0050" -> {"isValid": true, "data": "77064240050", "message": null}
"123" -> {"isValid": false, "data": null, "message": "Пожалуйста, введите корректный номер телефона\\n\\nНапример:\\n+7 706 424 0050\\n77064240050"}
"привет" -> {"isValid": false, "data": null, "message": "Пожалуйста, введите номер телефона цифрами"}`
		}

		const result = await generativeModel.generateContent(prompt)
		const response = result.response.candidates[0].content.parts[0].text
		const jsonMatch = response.match(/\{[\s\S]*\}/)

		if (jsonMatch) {
			const validation = JSON.parse(jsonMatch[0])
			console.log(
				`📝 Валидация ${dataType === 'name' ? 'имени' : 'телефона'}:`,
				validation
			)
			return validation
		}
	} catch (error) {
		console.error(`Ошибка валидации ${dataType}:`, error)
	}

	// Fallback на простую валидацию
	if (dataType === 'name') {
		const cleanName = userMessage.trim().split(/\s+/)[0]
		if (cleanName.length < 2 || cleanName.startsWith('/')) {
			return {
				isValid: false,
				data: null,
				message: 'Пожалуйста, напишите ваше имя (минимум 2 буквы)',
			}
		}
		return { isValid: true, data: cleanName, message: null }
	} else if (dataType === 'phone') {
		const cleanPhone = userMessage.replace(/[^0-9+]/g, '').replace(/^8/, '7')
		if (cleanPhone.length < 10 || cleanPhone.length > 15) {
			return {
				isValid: false,
				data: null,
				message:
					'Пожалуйста, введите корректный номер телефона\n\nНапример:\n+7 706 424 0050\n77064240050',
			}
		}
		return { isValid: true, data: cleanPhone, message: null }
	}
}

async function handleMessage(msg, sock) {
	const userId = msg.key.remoteJid
	const userMessage = getMessageText(msg).trim()
	
	// Пропускаем пустые сообщения
	if (!userMessage) return

	// Получение состояния разговора
	let conversation = await getConversation(userId)

	// Проверка fromMe и групп теперь в initWhatsApp()

	// ===================== ПРОВЕРКА ИСТЕЧЕНИЯ СЕССИИ =====================
	if (conversation) {
		const isExpired = await checkSessionExpiry(conversation)

		if (isExpired) {
			console.log(`⏰ Сессия истекла для ${userId}, сбрасываем тихо`)

			// Сбрасываем сессию БЕЗ уведомления (silent mode)
			await resetSession(userId, true)

			// Обнуляем conversation, чтобы обработать сообщение как новое
			conversation = null

			// НЕ отправляем уведомление - просто обрабатываем текущее сообщение заново
		}
	}

	// Проверка команд администратора
	const isUserAdmin = id => {
		const cleanId = id.replace(/@.+/, '')
		return CONFIG.ADMIN_WHITELIST.some(
			adminId => adminId.replace(/@.+/, '') === cleanId
		)
	}

	if (isUserAdmin(userId)) {
		console.log(`👤 Admin call detected from ${userId}: ${userMessage}`)

		if (userMessage === '/admin') {
			return await sendAdminStats(msg, sock)
		}

		if (userMessage === '/dashboard') {
			return await sendDashboardLink(msg, sock)
		}

		if (userMessage.match(/^\/ok\s+\d+$/)) {
			return await confirmBooking(msg, sock, userMessage)
		}

		if (userMessage.match(/^\/no\s+\d+$/)) {
			return await rejectBooking(msg, sock, userMessage)
		}

		// Подключение к чату с клиентом
		if (userMessage.startsWith('/connect')) {
			const phoneInput = userMessage.split(' ')[1]
			if (!phoneInput)
				return await replyMessage(sock, msg, '❌ Укажите номер: /connect 7701...')
			const phoneToConnect = phoneInput.replace(/[^0-9]/g, '')

			try {
				let targetUserId = null

				const convRes = await pool.query(
					`SELECT user_id FROM conversations 
					 WHERE client_phone LIKE $1 OR client_phone LIKE $2`,
					[`%${phoneToConnect}`, `%${phoneToConnect.slice(1)}`]
				)

				if (convRes.rows.length > 0) {
					targetUserId = convRes.rows[0].user_id
				} else {
					const clientRes = await pool.query(
						'SELECT user_id FROM clients WHERE phone = $1',
						[phoneToConnect]
					)
					if (clientRes.rows.length > 0) {
						targetUserId = clientRes.rows[0].user_id
					}
				}

				if (!targetUserId)
					return await replyMessage(sock, msg, 
						'❌ Клиент с таким номером не найден (или нет активного диалога).'
					)

				const updateRes = await pool.query(
					'UPDATE conversations SET is_admin_mode = TRUE, admin_chat_id = $2 WHERE user_id = $1',
					[targetUserId, userId]
				)

				if (updateRes.rowCount === 0) {
					const altUserId = targetUserId.includes('@c.us')
						? targetUserId.replace('@c.us', '@lid')
						: targetUserId.replace('@lid', '@c.us')

					const updateRes2 = await pool.query(
						'UPDATE conversations SET is_admin_mode = TRUE, admin_chat_id = $2 WHERE user_id = $1',
						[altUserId, userId]
					)

					if (updateRes2.rowCount === 0) {
						return await replyMessage(sock, msg, 
							`❌ Ошибка: Не удалось обновить статус диалога. ID: ${targetUserId}`
						)
					}
					targetUserId = altUserId
				}

				return await replyMessage(sock, msg, 
					`✅ Режим оператора включен для ${phoneToConnect}.\nID: ${targetUserId}\nВсе сообщения пересылаются.`
				)
			} catch (e) {
				console.error(e)
				return await replyMessage(sock, msg, 'Ошибка: ' + e.message)
			}
		}

		// Завершение чата
		if (userMessage === '/close') {
			try {
				const res = await pool.query(
					'SELECT user_id FROM conversations WHERE admin_chat_id = $1 AND is_admin_mode = TRUE',
					[userId]
				)

				if (res.rows.length > 0) {
					const clientUserId = res.rows[0].user_id
					await pool.query(
						'UPDATE conversations SET is_admin_mode = FALSE, admin_chat_id = NULL WHERE user_id = $1',
						[clientUserId]
					)
					await sendMessage(sock, 
						clientUserId,
						'👩‍💻 Оператор завершил диалог. Я снова с вами! Чем могу помочь?'
					)
					return await replyMessage(sock, msg, `✅ Диалог завершен. AI снова включен.`)
				} else {
					return await replyMessage(sock, msg, '❌ У вас нет активных диалогов')
				}
			} catch (e) {
				console.error(e)
			}
		}

		// Пересылка сообщений в активном диалоге
		try {
			const res = await pool.query(
				'SELECT user_id FROM conversations WHERE admin_chat_id = $1 AND is_admin_mode = TRUE',
				[userId]
			)
			if (res.rows.length > 0) {
				const clientUserId = res.rows[0].user_id
				await sendMessage(sock, 
					clientUserId,
					`👩‍💻 Администратор: ${userMessage}`
				)
				return
			}
		} catch (e) {
			console.error(e)
		}
	} else {
		// Проверка неправомерного использования админских команд
		if (
			userMessage.startsWith('/connect') ||
			userMessage.startsWith('/close') ||
			userMessage.match(/^\/ok\s+\d+$/) ||
			userMessage.match(/^\/no\s+\d+$/)
		) {
			console.log(
				`⚠️ Попытка использовать админскую команду от не-админа ${userId}`
			)
			return await replyMessage(sock, msg, 
				'❌ У вас нет прав администратора. Проверьте консоль.'
			)
		}
	}

	// Команда связи с оператором
	if (
		userMessage.toLowerCase().includes('оператор') ||
		userMessage.toLowerCase().includes('админ') ||
		userMessage.toLowerCase().includes('менеджер')
	) {
		await replyMessage(sock, msg, 'Передала ваш запрос менеджерам! 👩‍💻 Скоро ответим.')

		for (const adminId of CONFIG.ADMIN_WHITELIST) {
			const cleanPhone = conversation
				? conversation.client_phone
				: userId.replace('@c.us', '')
			await sendMessage(sock, 
				adminId,
				`🔔 Клиент просит оператора!\nИмя: ${conversation?.client_name}\nТелефон: ${cleanPhone}\n\nПодключиться: /connect ${cleanPhone}`
			)
		}
		return
	}

	// Команда изменения имени
	if (userMessage.match(/^\/update_name\s+.+$/i)) {
		const newName = userMessage
			.replace(/^\/update_name\s+/i, '')
			.trim()
			.split(/\s+/)[0]

		if (conversation) {
			conversation.client_name = newName
			if (!conversation.client_phone) {
				conversation.client_phone = await extractPhoneNumber(userId)
			}
			await saveConversation(conversation)
			await saveClient(conversation.client_phone, newName, userId)

			return await replyMessage(sock, msg, 
				`✅ Ваше имя обновлено: ${newName}\n\nТеперь я буду обращаться к вам так! 🤍`
			)
		}
	}

	// Команда просмотра данных
	if (userMessage === '/myinfo') {
		if (conversation) {
			let phone = conversation.client_phone

			const isLidUser = userId.includes('@lid')
			const phoneLooksLikeLid = phone && phone.length > 13

			if ((!phone || phoneLooksLikeLid) && isLidUser) {
				try {
					const extractedId = await extractPhoneNumber(userId)
					const searchId = extractedId + '@c.us'

					const result = await pool.query(
						'SELECT phone FROM clients WHERE user_id = $1',
						[searchId]
					)
					if (result.rows.length > 0 && result.rows[0].phone) {
						phone = result.rows[0].phone
						conversation.client_phone = phone
						await saveConversation(conversation)
					}
				} catch (e) {
					console.error('Ошибка поиска телефона в БД:', e)
				}
			}

			if (!phone) {
				phone = await extractPhoneNumber(userId)
			}

			return await replyMessage(sock, msg, 
				`👤 ВАШИ ДАННЫЕ:\n\n` +
					`Имя: ${conversation.client_name || 'не указано'}\n` +
					`Телефон: ${phone}\n\n` +
					`Для изменения имени отправьте:\n` +
					`/update_name Ваше_Новое_Имя`
			)
		}
	}

	// Создание новой сессии
	if (!conversation) {
		// ПРОВЕРЯЕМ: есть ли клиент уже в базе данных (по user_id или @lid/@c.us варианту)
		let existingClient = null
		try {
			// Сначала ищем по текущему user_id
			let clientResult = await pool.query(
				'SELECT name, phone FROM clients WHERE user_id = $1',
				[userId]
			)
			
			if (clientResult.rows.length === 0) {
				// Попробуем альтернативный ID (@lid <-> @c.us)
				const altUserId = userId.includes('@lid') 
					? userId.replace('@lid', '@c.us') 
					: userId.replace('@c.us', '@lid')
				
				clientResult = await pool.query(
					'SELECT name, phone FROM clients WHERE user_id = $1',
					[altUserId]
				)
			}
			
			if (clientResult.rows.length > 0) {
				existingClient = clientResult.rows[0]
				console.log(`✅ Найден существующий клиент: ${existingClient.name} (${existingClient.phone})`)
			}
		} catch (error) {
			console.error('Ошибка поиска клиента:', error)
		}

		// Если клиент уже существует - используем его данные
		if (existingClient && existingClient.name && existingClient.phone) {
			conversation = {
				user_id: userId,
				stage: 'conversation',
				history: [],
				booking_data: {},
				client_name: existingClient.name,
				client_phone: existingClient.phone,
			}
			await saveConversation(conversation)

			console.log(`🔄 Восстановлена сессия для ${existingClient.name} (${existingClient.phone})`)
			
			return await replyMessage(sock, msg, 
				`Здравствуйте, ${existingClient.name}! 👋\nРада снова вас видеть в ${CONFIG.SALON_NAME} ✨\n\nЧем могу помочь?\n\n💅 Маникюр\n👁 Брови и ресницы\n🌸 Шугаринг`
			)
		}

		// Новый клиент - запрашиваем данные
		conversation = {
			user_id: userId,
			stage: 'asking_name_and_phone',
			history: [],
			booking_data: {},
			client_name: null,
			client_phone: await extractPhoneNumber(userId),
		}
		await saveConversation(conversation)

		return await replyMessage(sock, msg, 
			`Здравствуйте! ❤️\nДобро пожаловать в салон красоты ${CONFIG.SALON_NAME} ✨\n\nКак мне к вам обращаться?\nНапишите, пожалуйста, ваше имя и номер телефона 🤍`
		)
	}

	// Запрос имени и телефона
	if (conversation.stage === 'asking_name_and_phone') {
		const nameValidation = await validateUserDataWithGemini(userMessage, 'name')

		if (!nameValidation.isValid) {
			return await replyMessage(sock, msg, 
				`${nameValidation.message}\n\n💡 Напишите, пожалуйста, ваше имя и номер телефона`
			)
		}

		const cleanName = nameValidation.data
		const phoneValidation = await validateUserDataWithGemini(
			userMessage,
			'phone'
		)

		const extractedPhone = await extractPhoneNumber(userId)
		const isLidUser = userId.includes('@lid')

		let finalPhone = null

		if (phoneValidation.isValid) {
			finalPhone = phoneValidation.data
			console.log(`📞 Телефон извлечён из сообщения: ${finalPhone}`)
		} else if (!isLidUser && extractedPhone !== userId.replace(/@.*$/, '')) {
			finalPhone = extractedPhone
			console.log(`📞 Телефон получен из WhatsApp ID: ${finalPhone}`)
		}

		if (!finalPhone) {
			conversation.client_name = cleanName
			conversation.stage = 'asking_phone_only'
			await saveConversation(conversation)

			return await replyMessage(sock, msg, 
				`Приятно познакомиться, ${cleanName}! ✨\n\nТеперь напишите, пожалуйста, ваш номер телефона 📱`
			)
		}

		conversation.client_name = cleanName
		conversation.client_phone = finalPhone
		conversation.stage = 'conversation'
		await saveConversation(conversation)
		await saveClient(finalPhone, cleanName, userId)

		return await replyMessage(sock, msg, 
			`Отлично, ${cleanName}! Все данные сохранены ✅\n\nЯ помогу вам записаться на услугу. Расскажите, что вас интересует? Или выберите:\n\n💅 Маникюр\n👁 Брови и ресницы\n🌸 Шугаринг`
		)
	}

	// Запрос только телефона
	if (conversation.stage === 'asking_phone_only') {
		const phoneValidation = await validateUserDataWithGemini(
			userMessage,
			'phone'
		)

		if (!phoneValidation.isValid) {
			return await replyMessage(sock, msg, phoneValidation.message)
		}

		conversation.client_phone = phoneValidation.data
		conversation.stage = 'conversation'
		await saveConversation(conversation)
		await saveClient(
			conversation.client_phone,
			conversation.client_name,
			userId
		)

		return await replyMessage(sock, msg, 
			`Отлично, ${conversation.client_name}! Номер сохранен ✅\n\nТеперь расскажите, что вас интересует?\n\n💅 Маникюр\n👁 Брови и ресницы\n🌸 Шугаринг\n\nКакой мастер вам удобен и когда вы хотели бы прийти?`
		)
	}

	// Обработка ожидания подтверждения записи (Phase 4: Explicit Confirmation)
	if (conversation.stage === 'awaiting_confirmation') {
		const pendingBooking = conversation.booking_data?.pending_booking;
		
		if (!pendingBooking) {
			console.error('❌ [INVARIANT_VIOLATION] awaiting_confirmation without pending_booking');
			conversation.stage = 'conversation';
			await saveConversation(conversation);
			return await replyMessage(sock, msg, 
				'Произошла ошибка. Давайте начнём сначала - какую услугу вы хотели бы?'
			);
		}

		if (isUserConfirmation(userMessage)) {
			console.log(`✅ Клиент подтвердил запись: ${conversation.client_name}`);
			
			// CRITICAL FIX: Clean state BEFORE creating booking to prevent invariant violation
			// The conversation will be in 'conversation' stage when initiateBookingConfirmation tries to save it
			const bookingToCreate = { ...pendingBooking };
			conversation.booking_data.pending_booking = null;
			conversation.stage = 'conversation';
			await saveConversation(conversation);
			
			// Создаём запись
			await initiateBookingConfirmation(
				msg,
				sock,
				conversation,
				bookingToCreate
			);
			return;
		}
		
		if (isUserDenial(userMessage)) {
			console.log(`❌ Клиент отказался от записи: ${conversation.client_name}`);
			
			conversation.booking_data.pending_booking = null;
			conversation.stage = 'conversation';
			await saveConversation(conversation);
			
			return await replyMessage(sock, msg, 
				'Хорошо, запись отменена! 👌\n\nЕсли хотите изменить что-то — просто напишите, и мы подберём другой вариант.'
			);
		}
		
		// Если клиент написал что-то другое — возможно хочет изменить данные
		console.log(`🔄 Клиент хочет изменить данные, возвращаемся в диалог`);
		
		conversation.booking_data.pending_booking = null;
		conversation.stage = 'conversation';
		
		// Добавляем сообщение в историю и передаём AI для обработки
		conversation.history.push({
			role: 'user',
			content: userMessage,
			timestamp: new Date().toISOString(),
		});
		
		await saveConversation(conversation);
		await generateAndSendResponse(msg, conversation, sock);
		return;
	}

	// Режим оператора
	if (conversation.is_admin_mode && conversation.admin_chat_id) {
		try {
			await sendMessage(sock, 
				conversation.admin_chat_id,
				`👤 Клиент ${
					conversation.client_name || conversation.client_phone
				}: ${userMessage}`
			)

			conversation.history.push({
				role: 'user',
				content: userMessage,
				timestamp: new Date().toISOString(),
			})

			await saveConversation(conversation)
			return
		} catch (e) {
			console.error('Ошибка пересылки сообщения админу:', e)
		}
	}

	// Добавление в историю
	conversation.history.push({
		role: 'user',
		content: userMessage,
		timestamp: new Date().toISOString(),
	})

	await saveConversation(conversation)

	// Генерация ответа
	await generateAndSendResponse(msg, conversation, sock)
}

// Получение разговора из БД
async function getConversation(userId) {
	try {
		const result = await pool.query(
			'SELECT * FROM conversations WHERE user_id = $1',
			[userId]
		)
		return result.rows[0] || null
	} catch (error) {
		console.error('Ошибка получения разговора:', error)
		return null
	}
}

// Сохранение разговора в БД (с проверкой инвариантов)
async function saveConversation(conversation) {
	// CRITICAL: Validate invariants BEFORE saving
	const invariantCheck = assertStageInvariants(conversation);
	if (!invariantCheck.valid) {
		console.error(`❌ [SAVE_BLOCKED] Invariant violation: ${invariantCheck.code} for user ${conversation.user_id}`);
		await logRejection(pool, conversation.user_id, 'INVARIANT_VIOLATION', {
			code: invariantCheck.code,
			stage: conversation.stage,
			has_name: !!conversation.client_name,
			has_phone: !!conversation.client_phone,
			has_pending_booking: !!conversation.booking_data?.pending_booking
		});
		
		// Fail-fast: throw instead of silently saving invalid state
		throw new Error(`INVARIANT_VIOLATION: ${invariantCheck.code}`);
	}
	
	try {
		await pool.query(
			`
			INSERT INTO conversations (
        user_id, 
        stage, 
        history, 
        booking_data, 
        client_name, 
        client_phone, 
        is_admin_mode, 
        admin_chat_id,
        updated_at
      )
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
			ON CONFLICT (user_id) 
			DO UPDATE SET 
				stage = $2,
				history = $3,
				booking_data = $4,
				client_name = $5,
				client_phone = $6,
				is_admin_mode = $7,
				admin_chat_id = $8,
				updated_at = CURRENT_TIMESTAMP
		`,
			[
				conversation.user_id,
				conversation.stage,
				JSON.stringify(conversation.history),
				JSON.stringify(conversation.booking_data),
				conversation.client_name,
				conversation.client_phone,
				conversation.is_admin_mode || false,
				conversation.admin_chat_id || null,
			]
		);
	} catch (error) {
		console.error(`❌ [DB_ERROR] Failed to save conversation for ${conversation.user_id}:`, error);
		throw error; // Re-throw to prevent silent failures
	}
}

// ===================== УПРАВЛЕНИЕ СЕССИЯМИ =====================
// Проверка активности сессии (30 минут)
async function checkSessionExpiry(conversation) {
	if (!conversation || !conversation.updated_at) return false

	const now = new Date()
	const lastUpdate = new Date(conversation.updated_at)
	const diffMinutes = (now - lastUpdate) / (1000 * 60)

	// Если прошло более 30 минут
	if (diffMinutes > 30) {
		console.log(
			`⏰ Сессия истекла для ${conversation.user_id} (${Math.round(
				diffMinutes
			)} мин)`
		)
		return true
	}

	return false
}

// Сброс сессии (обнуление данных) БЕЗ отправки уведомления
async function resetSession(userId, silent = false) {
	try {
		await pool.query(
			`UPDATE conversations 
       SET stage = 'greeting',
           history = '[]'::jsonb,
           booking_data = '{}'::jsonb,
           is_admin_mode = FALSE,
           admin_chat_id = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
			[userId]
		)

		console.log(`🔄 Сессия сброшена для ${userId}${silent ? ' (тихо)' : ''}`)
		return true
	} catch (error) {
		console.error('Ошибка сброса сессии:', error)
		return false
	}
}

// Уведомление о завершении сессии (только когда нужно)
async function notifySessionExpired(userId) {
	try {
		await sendMessage(sock, 
			userId,
			`⏰ Ваша сессия завершена из-за неактивности.\n\nЕсли хотите продолжить - просто напишите мне снова! 🤍\n\nЯ буду рада помочь вам! ✨`
		)
		console.log(`✅ Уведомление о завершении сессии отправлено: ${userId}`)
	} catch (error) {
		console.error('Ошибка отправки уведомления о сессии:', error)
	}
}
async function saveClient(phone, name, userId) {
	try {
		// Fix: Используем ID как есть, не форсируем суффикс, чтобы не ломать @lid
		const cleanPhone = phone.includes('@')
			? await extractPhoneNumber(phone)
			: phone

		// Если userId не передан, не пытаемся его угадать/создать неправильно
		// Но обычно он передается.

		await pool.query(
			`INSERT INTO clients (phone, name, user_id, created_at)
			VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
			ON CONFLICT (phone) 
			DO UPDATE SET 
				name = EXCLUDED.name,
				user_id = EXCLUDED.user_id`,
			[cleanPhone, name, userId]
		)
		console.log(`✅ Клиент сохранен/обновлен: ${name} (${cleanPhone})`)
	} catch (error) {
		console.error('Ошибка сохранения клиента:', error)
	}
}

// Отправка ссылки на dashboard
// Отправка ссылки на dashboard
async function sendDashboardLink(msg, sock) {
	await replyMessage(sock, msg, 
		`📊 Dashboard салона La Mirage Beauty\n\n🌐 Откройте в браузере:\nhttp://localhost:3000\n\nЧтобы запустить dashboard, выполните в терминале:\nnpm run dashboard`
	)
}
// Отправка приветствия
async function sendGreeting(msg, sock) {
	const greeting = `Здравствуйте!❤️
Вас приветствует салон красоты ${CONFIG.SALON_NAME} ✨
Очень рада вашему обращению!🫶

Напишите, пожалуйста:
• На какую услугу вы хотите записаться?
• К какому мастеру?
• Когда вам будет удобно прийти?

Я с радостью помогу вам с записью ✨
Спасибо, что выбираете ${CONFIG.SALON_NAME} 🤍`

	await replyMessage(sock, msg, greeting)
}

// Генерация ответа с Gemini AI
async function generateAndSendResponse(msg, conversation, sock) {
	try {
		const systemPrompt = createSystemPrompt(conversation.client_name)
		const chatHistory = conversation.history.slice(-10).map(msg => ({
			role: msg.role === 'user' ? 'user' : 'model',
			parts: [{ text: msg.content }],
		}))

		// Формируем полный промпт с историей для Vertex AI
		const fullPrompt = `${systemPrompt}

ИСТОРИЯ ДИАЛОГА:
${chatHistory
	.map(h => `${h.role === 'user' ? 'Клиент' : 'Бот'}: ${h.parts[0].text}`)
	.join('\n')}

НОВОЕ СООБЩЕНИЕ КЛИЕНТА:
${conversation.history[conversation.history.length - 1]?.content || ''}

ТВОЙ ОТВЕТ:`

		const result = await generativeModel.generateContent(fullPrompt)
	
	// Проверка на корректность ответа Gemini
	if (!result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
		console.error('❌ Gemini вернул некорректный ответ:', JSON.stringify(result.response, null, 2));
		throw new Error('Gemini API returned invalid response structure');
	}
	
	let response = result.response.candidates[0].content.parts[0].text

		console.log(`🤖 Ответ AI (сырой): ${response.substring(0, 200)}...`)

		// ПРОВЕРКА НА ЗАПРОС ДОСТУПНОСТИ ВРЕМЕНИ
		const availabilityMatch = response.match(
			/ПРОВЕРИТЬ_ДОСТУПНОСТЬ:\s*мастер=(.+?),\s*дата=(\d{4}-\d{2}-\d{2}),\s*время=(\d{2}:\d{2})/i
		)

		if (availabilityMatch) {
			const [fullMatch, masterName, checkDate, checkTime] = availabilityMatch

			console.log(`🔍 Обнаружена команда проверки доступности:`)
			console.log(`   Мастер: ${masterName.trim()}`)
			console.log(`   Дата: ${checkDate}`)
			console.log(`   Время: ${checkTime}`)

			// Находим длительность услуги из последних сообщений
			const recentMessages = conversation.history.slice(-3)
			let serviceDuration = 60
			let serviceName = null

			for (const msg of recentMessages) {
				if (msg.role === 'user') {
					const messageText = msg.content.toLowerCase()
					const foundService = SALON_DATA.services.find(s => {
						const serviceNameLower = s.name.toLowerCase()
						return (
							messageText.includes(serviceNameLower) ||
							messageText.includes(serviceNameLower.substring(0, 15))
						)
					})

					if (foundService) {
						serviceDuration = foundService.duration
						serviceName = foundService.name
						console.log(
							`⏱️ Определена услуга: ${serviceName}, длительность: ${serviceDuration} мин`
						)
						break
					}
				}
			}

			// Проверяем доступность КОНКРЕТНОГО времени
			const isFree = await checkAvailability(
				masterName.trim(),
				checkDate,
				checkTime,
				serviceDuration
			)

			if (!isFree) {
				console.log(`⛔ Время ${checkTime} на ${checkDate} ЗАНЯТО!`)

				// Получаем список свободных слотов
				const availableSlots = await getAvailableSlots(
					masterName.trim(),
					checkDate
				)

				let busyMessage = `\n\n⚠️ К сожалению, время ${checkTime} на ${formatDateForDisplay(
					checkDate
				)} к мастеру ${masterName.trim()} уже занято! 😔`

				if (availableSlots.length > 0) {
					const slotsText = availableSlots
						.slice(0, 10)
						.map(time => `• ${time}`)
						.join('\n')
					busyMessage += `\n\nСвободные окна на эту дату:\n${slotsText}\n\nВыберите удобное время!`
				} else {
					busyMessage += `\n\nК сожалению, на эту дату все занято. Попробуйте другой день! 🤍`
				}

				// Удаляем команду проверки и добавляем сообщение о занятости
				response = response.replace(/ПРОВЕРИТЬ_ДОСТУПНОСТЬ:.+/i, busyMessage)

				// Сохраняем и отправляем
				conversation.history.push({
					role: 'assistant',
					content: response,
					timestamp: new Date().toISOString(),
				})
				await saveConversation(conversation)

				return await replyMessage(sock, msg, response)
			} else {
				// Время СВОБОДНО - убираем команду, продолжаем запись
				console.log(
					`✅ Время ${checkTime} СВОБОДНО! Продолжаем создание записи...`
				)
				response = response.replace(/\s*ПРОВЕРИТЬ_ДОСТУПНОСТЬ:.+/i, '')
			}
		}

		// ========== ОБРАБОТКА КОМАНДЫ ПОКАЗАТЬ_РАСПИСАНИЕ ==========
		if (response.includes('ПОКАЗАТЬ_РАСПИСАНИЕ:')) {
			const scheduleMatch = response.match(/ПОКАЗАТЬ_РАСПИСАНИЕ:\s*мастер=([^,]+),\s*дата=([^\s]+)/);
			
			if (scheduleMatch) {
				const [, masterName, date] = scheduleMatch;
				
				console.log(`📅 Обнаружена команда показа расписания:`);
				console.log(`   Мастер: ${masterName.trim()}`);
				console.log(`   Дата: ${date}`);
				
				// Получаем свободные слоты с минимальной длительностью (60 мин)
				const availableSlots = await getAvailableSlots(masterName.trim(), date, 60);
				
				if (availableSlots.length > 0) {
					const slotsText = availableSlots
						.map(time => `• ${time}`)
						.join('\n');
					
					const scheduleInfo = `\n\n📅 Свободные окошки у мастера ${masterName.trim()} на ${formatDateForDisplay(date)}:\n${slotsText}\n\n(это для услуг продолжительностью до 60 минут)\n\nЧтобы записаться, выберите услугу из списка! ✨`;
					
					response = response.replace(/ПОКАЗАТЬ_РАСПИСАНИЕ:.+/, scheduleInfo);
				} else {
					response = response.replace(/ПОКАЗАТЬ_РАСПИСАНИЕ:.+/, `\n\n😔 К сожалению, у мастера ${masterName.trim()} на ${formatDateForDisplay(date)} все занято. Попробуйте другую дату!`);
				}
				
				console.log(`✅ Расписание обработано`);
			}
		}

		conversation.history.push({
			role: 'assistant',
			content: response,
			timestamp: new Date().toISOString(),
		})

		await saveConversation(conversation)

		// Проверка намерения записаться
		const bookingIntent = await detectBookingIntent(conversation)

		if (bookingIntent.ready) {
			console.log(`📋 Все данные собраны, запрашиваем подтверждение...`);
			
			// Сохраняем pending_booking и переводим в стадию ожидания подтверждения
			if (!conversation.booking_data) {
				conversation.booking_data = {};
			}
			conversation.booking_data.pending_booking = bookingIntent.data;
			conversation.stage = 'awaiting_confirmation';
			await saveConversation(conversation);
			
			// Отправляем сообщение с подтверждением
			const confirmMsg = formatBookingConfirmationMessage(
				bookingIntent.data, 
				conversation.client_name
			);
			
			return await replyMessage(sock, msg, confirmMsg);
		} else if (bookingIntent.slotBusy) {
			console.log(`⚠️ Слот занят (дублирование проверки)`)

			// Получаем свободные слоты на эту дату
			const availableSlots = await getAvailableSlots(
				bookingIntent.data.master,
				bookingIntent.data.date
			)

			let busyMessage = `⚠️ Ой! Прошу прощения, но время ${
				bookingIntent.data.time
			} на ${formatDateForDisplay(bookingIntent.data.date)} к мастеру ${
				bookingIntent.data.master
			} уже занято. 😔`

			if (availableSlots.length > 0) {
				const slotsText = availableSlots
					.slice(0, 5)
					.map(time => `• ${time}`)
					.join('\n')
				busyMessage += `\n\nСвободное время на эту дату:\n${slotsText}\n\nВыберите другое время!`
			} else {
				busyMessage += `\n\nК сожалению, на эту дату все занято. Попробуйте другой день! 🤍`
			}

			await replyMessage(sock, msg, busyMessage)
		} else {
			// Детекция отмены
			const lastUserMessage = conversation.history[conversation.history.length - 1]?.content || ''
			if (await detectCancellation(conversation.user_id, lastUserMessage, sock)) {
				await replyMessage(sock, msg, 
					'Хорошо, я отменила вашу последнюю активную запись/заявку. 👌\n\nЕсли захотите записаться снова — просто напишите!'
				)
				conversation.booking_data = {}
				await saveConversation(conversation)
				return
			}

			// Обычный ответ
			await replyMessage(sock, msg, response)
		}
	} catch (error) {
		console.error('Ошибка Gemini AI:', error)
		console.error('Детали ошибки:', error.stack)
		await replyMessage(sock, msg, 
			'Извините, произошла техническая ошибка. Попробуйте еще раз или позвоните нам.'
		)
	}
}
// ===================== СОЗДАНИЕ СИСТЕМНОГО ПРОМПТА С ДАТАМИ =====================
function createSystemPrompt(clientName) {
	const mastersInfo = SALON_DATA.masters
		.map(m => `${m.name} - ${m.specialty}`)
		.join('\n')

	// Группируем услуги по мастерам для более читаемого формата
	const yunaServices = SALON_DATA.services
		.filter(s => s.master === 'Юна')
		.map(s => `  ${s.name} - ${s.price} тг`)
		.join('\n')

	const otherMastersServices = SALON_DATA.services
		.filter(s => s.master === 'другие' && s.category === 'маникюр')
		.map(s => `  ${s.name} - ${s.price} тг`)
		.join('\n')

	const lenaServices = SALON_DATA.services
		.filter(s => s.master === 'Лена')
		.map(s => `  ${s.name} - ${s.price} тг`)
		.join('\n')

	const servicesInfo = `МАНИКЮР

Мастер Юна (главный мастер):
${yunaServices}

Мастера: Аружан, Айгерим, Гульназ, Жазира
${otherMastersServices}

БРОВИ, РЕСНИЦЫ И ШУГАРИНГ

Мастер Лена:
${lenaServices}`

	// Получаем ближайшие даты
	const today = getToday()
	const tomorrow = getTomorrow()
	const todayDisplay = formatDateForDisplay(today)
	const tomorrowDisplay = formatDateForDisplay(tomorrow)
	const nextDays = getNextDays(5)
		.map(d => `${d.display} (${d.dayName})`)
		.join(', ')

	return `Ты - виртуальный администратор салона красоты "${CONFIG.SALON_NAME}".

ТВОЯ РОЛЬ:
- Дружелюбный, милый и приветливый помощник
- Твоя цель: помочь клиенту выбрать услугу, показать цены, и затем помочь с записью
- Обращайся к клиенту по имени: ${clientName || 'клиент'}
- Пиши естественно и тепло, используй эмодзи умеренно (✨, 💅, 🤍)
- КРИТИЧЕСКИ ВАЖНО: НИКОГДА не используй markdown форматирование - НЕ используй звездочки, жирный текст, подчеркивания
- Пиши обычным текстом без форматирования
- Общайся приветливо, но не перегружай сообщения

ИНФОРМАЦИЯ О САЛОНЕ:
Режим работы: ${SALON_DATA.workingHours}
Адрес: ${SALON_DATA.address}
Instagram: ${CONFIG.INSTAGRAM_LINK}

ТЕКУЩАЯ ДАТА:
Сегодня: ${todayDisplay}
Завтра: ${tomorrowDisplay}

НАШИ МАСТЕРА:
${mastersInfo}

УСЛУГИ И ЦЕНЫ:
${servicesInfo}

МАТЕРИАЛЫ: ${SALON_DATA.materialInfo}

ГЛАВНЫЕ ПРАВИЛА ОБЩЕНИЯ:

1. ВСЕГДА УТОЧНЯЙ КОНКРЕТНУЮ УСЛУГУ И ПОКАЗЫВАЙ ЦЕНЫ:
   
   ❌ НЕПРАВИЛЬНО:
   Клиент: "Хочу на брови сегодня в 11"
   Ты: "Отлично! Записываю вас на услугу по бровям к мастеру Лене..."
   
   ✅ ПРАВИЛЬНО:
   Клиент: "Хочу на брови сегодня в 11"
   Ты: "Отлично! У нас есть несколько услуг по бровям от мастера Лены:
   
   • Коррекция бровей (воск/пинцет) - 1500 тг
   • Окрашивание бровей - 2000 тг
   • Ламинирование бровей (окрашивание + ботокс) - 5000 тг
   
   Какая услуга вас интересует?"

2. ДЛЯ МАНИКЮРА - УТОЧНЯЙ МАСТЕРА И ПОКАЗЫВАЙ РАЗНИЦУ В ЦЕНАХ:
   
   Клиент: "Хочу маникюр"
   Ты: "Отлично! У нас работают несколько мастеров с разными ценами:
   
   Юна (главный мастер):
   • Маникюр без покрытия - 3000 тг
   • Маникюр с укреплением - 7000 тг
   • Наращивание типсами - 9000 тг
   
   Другие мастера (Аружан, Айгерим, Гульназ, Жазира):
   • Маникюр без покрытия - 1000 тг
   • Маникюр с укреплением - 3500 тг
   • Наращивание - 5000 тг
   
   К какому мастеру хотите записаться?"

3. ДЛЯ РЕСНИЦ И ШУГАРИНГА - ПОКАЗЫВАЙ ВЕСЬ СПИСОК:
   
   Клиент: "Хочу наращивание ресниц"
   Ты: "Отлично! Мастер Лена делает наращивание ресниц:
   
   • Классика - 6000 тг
   • 2Д-3Д - 7000 тг
   • Мокрый эффект до 3.5Д - 7000 тг
   • Мокрый эффект от 4Д - 8000 тг
   • 4Д-5Д изгибы LM - 8000 тг
   
   Какой эффект вам больше нравится?"

3.5. ЗАПРОС РАСПИСАНИЯ БЕЗ ВЫБОРА УСЛУГИ:
   
   Если клиент спрашивает о свободном времени БЕЗ выбора конкретной услуги:
   
   Клиент: "какое время свободно у Юны сегодня?"
   Ты: "Сейчас проверю свободное время! ПОКАЗАТЬ_РАСПИСАНИЕ: мастер=Юна, дата=${today}"
   
   После получения списка времени, покажи его и уточни услугу:
   "Вот свободные окошки у Юны на сегодня:
   • 10:00
   • 14:00  
   • 16:00
   
   (это для услуг продолжительностью до 60 минут)
   
   Какую услугу вы хотели бы сделать?"

4. ТОЛЬКО ПОСЛЕ ВЫБОРА КОНКРЕТНОЙ УСЛУГИ - проверяй время:
   - Когда клиент выбрал КОНКРЕТНУЮ услугу И указал время - добавь команду:
     "ПРОВЕРИТЬ_ДОСТУПНОСТЬ: мастер={имя}, дата={YYYY-MM-DD}, время={HH:MM}"
   - НЕ проверяй время ПОКА клиент не выбрал конкретную услугу

Пример ПРАВИЛЬНОГО диалога:
Клиент: "Хочу на брови сегодня в 11"
Ты: "Отлично! У нас есть услуги по бровям:
- Коррекция бровей - 1500 тг
- Окрашивание бровей - 2000 тг
- Ламинирование бровей - 5000 тг
Что выберете?"

Клиент: "Коррекцию"
Ты: "Замечательно! Записываю вас на коррекцию бровей к мастеру Лене на сегодня, 24 декабря, в 11:00. Цена 1500 тг ✨ ПРОВЕРИТЬ_ДОСТУПНОСТЬ: мастер=Лена, дата=${today}, време=11:00"

5. НЕ СОЗДАВАЙ ЗАПИСЬ без:
   - Конкретного названия услуги
   - Точной цены
   - Имени мастера
   - Даты и времени

ПРИМЕРЫ БЛИЖАЙШИХ ДАТ:
${nextDays}

6. КОГДА ВСЕ ДАННЫЕ ГОТОВЫ:
   - Подтверди все детали записи с КОНКРЕТНОЙ услугой
   - Назови ТОЧНУЮ цену
   - Будь приветливой и радостной

Веди диалог тепло и с заботой о клиенте! ❤️`
}

// ===================== ОПРЕДЕЛЕНИЕ НАМЕРЕНИЯ С УМНЫМИ ДАТАМИ =====================
async function detectBookingIntent(conversation) {
	const recentMessages = conversation.history
		.slice(-10)
		.map(m => `${m.role === 'user' ? 'Клиент' : 'Бот'}: ${m.content}`)
		.join('\n')

	const today = getToday()
	const tomorrow = getTomorrow()

	try {
		const prompt = `Проанализируй диалог и определи, готов ли клиент к записи.

Диалог:
${recentMessages}

Имя клиента: ${conversation.client_name}
Телефон клиента: ${conversation.client_phone}

ТЕКУЩАЯ ИНФОРМАЦИЯ:
Сегодняшняя дата: ${today}
Завтрашняя дата: ${tomorrow}

Доступные мастера: ${SALON_DATA.masters.map(m => m.name).join(', ')}

КРИТИЧЕСКИ ВАЖНО - ready = true ТОЛЬКО ЕСЛИ:
1. Есть КОНКРЕТНОЕ название услуги (не просто "маникюр" или "брови", а "Коррекция бровей", "Маникюр с укреплением")
2. Есть ТОЧНАЯ цена в тенге (должна соответствовать конкретной услуге)
3. Есть имя мастера
4. Есть дата в формате YYYY-MM-DD
5. Есть время в формате HH:MM
6. Бот УЖЕ показал клиенту список услуг с ценами и клиент ВЫБРАЛ конкретную

ПРАВИЛА ОПРЕДЕЛЕНИЯ УСЛУГИ:
- "маникюр" БЕЗ уточнения - это НЕ конкретная услуга → ready = false
- "брови" БЕЗ уточнения - это НЕ конкретная услуга → ready = false
- "Коррекция бровей" - конкретная услуга → можно ready = true (если есть остальное)
- "Маникюр с укреплением" - конкретная услуга → можно ready = true (если есть остальное)

ЕСЛИ В ДИАЛОГЕ:
- Бот только спросил "какую услугу?" - ready ДОЛЖНО БЫТЬ false
- Бот показал прайс и ждёт выбора - ready ДОЛЖНО БЫТЬ false
- Клиент сказал общее ("маникюр", "брови") без уточнения - ready ДОЛЖНО БЫТЬ false
- Бот уже сказал что время занято - ready ДОЛЖНО БЫТЬ false
- Бот уже отправил запрос администратору - ready ДОЛЖНО БЫТЬ false

ЦЕНА должна СТРОГО соответствовать выбранной услуге из этого списка:
${SALON_DATA.services
	.map(s => `${s.name} (${s.master}) - ${s.price} тг`)
	.join('\n')}

ПРАВИЛА ОПРЕДЕЛЕНИЯ ДАТЫ:
- "сегодня" → ${today}
- "завтра" → ${tomorrow}
- Конкретное число → преобразуй в YYYY-MM-DD
- НЕ указана → null

ПРАВИЛА ОПРЕДЕЛЕНИЯ ВРЕМЕНИ:
- Извлекай ТОЧНОЕ время
- "11 утра" или "в 11:00" → "11:00"
- "14:30" → "14:30"
- НЕ указано → null

Ответь ТОЛЬКО в формате JSON:
{
  "ready": true/false,
  "service": "ТОЧНОЕ название услуги или null",
  "master": "имя мастера или null",
  "price": число или null,
  "date": "YYYY-MM-DD или null",
  "time": "HH:MM или null",
  "reason": "почему ready=false (если false)"
}

Примеры:

ПРИМЕР 1 - ready = FALSE (нет конкретной услуги):
Клиент: "Хочу на брови сегодня в 11"
Бот: "Отлично! У нас есть услуги: Коррекция - 1500 тг, Окрашивание - 2000 тг..."
→ {"ready": false, "reason": "клиент не выбрал конкретную услугу"}

ПРИМЕР 2 - ready = TRUE (все данные есть):
Клиент: "Хочу на брови сегодня в 11"
Бот: "У нас есть: Коррекция - 1500, Окрашивание - 2000. Что выберете?"
Клиент: "Коррекцию"
Бот: "Записываю на Коррекцию бровей к Лене..."
→ {"ready": true, "service": "Коррекция бровей воск/пинцет", "master": "Лена", "price": 1500, "date": "${today}", "time": "11:00"}`

		const result = await generativeModel.generateContent(prompt)
		const response = result.response.candidates[0].content.parts[0].text

		const jsonMatch = response.match(/\{[\s\S]*\}/)
		if (jsonMatch) {
			const data = JSON.parse(jsonMatch[0])

			// Проверка что все данные есть
			const isReady =
				data.ready &&
				data.service &&
				data.master &&
				data.price &&
				data.date &&
				data.time

			console.log('📋 Детекция записи:', {
				ready: isReady,
				service: data.service,
				master: data.master,
				price: data.price,
				date: data.date,
				time: data.time,
				reason: data.reason || 'все данные готовы',
			})

			// Если намерение готово, ПРОВЕРЯЕМ ДОСТУПНОСТЬ В БД
			if (isReady) {
				// Поиск длительности услуги
				const serviceObj = SALON_DATA.services.find(
					s =>
						s.name === data.service ||
						s.name.toLowerCase().includes(data.service.toLowerCase())
				)
				const duration = serviceObj ? serviceObj.duration : 60

				const isFree = await checkAvailability(
					data.master,
					data.date,
					data.time,
					duration
				)

				if (!isFree) {
					console.log(`⛔ Слот занят: ${data.master} ${data.date} ${data.time}`)
					return { ready: false, data: data, slotBusy: true }
				}
			}

			return { ready: isReady, data: data }
		}
	} catch (error) {
		console.error('Ошибка определения намерения:', error)
	}

	return { ready: false, data: null }
}

// ===================== ФУНКЦИИ ВАЛИДАЦИИ И ЛОГИРОВАНИЯ =====================

// Логирование действий с записями
async function logBookingAction(bookingId, action, details, userId) {
	try {
		await pool.query(
			`INSERT INTO booking_logs (booking_id, action, details, user_id)
			VALUES ($1, $2, $3, $4)`,
			[bookingId, action, JSON.stringify(details), userId]
		)
		console.log(`📝 Лог записан: ${action} для записи #${bookingId}`)
	} catch (error) {
		console.error('❌ Ошибка логирования:', error)
	}
}

// Валидация даты (не в прошлом, салон работает)
async function validateBookingDate(date) {
	try {
		const bookingDate = new Date(date)
		const today = new Date()
		today.setHours(0, 0, 0, 0)
		
		// Проверка что дата не в прошлом
		if (bookingDate < today) {
			// Log rejection for observability
			await logRejection(pool, 'SYSTEM', 'PAST_DATE', { attempted_date: date });
			return {
				valid: false,
				error: '⚠️ Невозможно создать запись на прошедшую дату. Пожалуйста, выберите сегодня или более позднюю дату.'
			}
		}
		
		// Проверка что дата не более чем через 60 дней
		const maxDate = new Date()
		maxDate.setDate(maxDate.getDate() + 60)
		if (bookingDate > maxDate) {
			return {
				valid: false,
				error: '⚠️ Записи доступны только на ближайшие 60 дней.'
			}
		}
		
		const dayOfWeek = bookingDate.getDay()
		// Салон работает ежедневно (0 = воскресенье, 6 = суббота)
		// Если есть выходные дни, добавьте проверку здесь
		
		return { valid: true }
	} catch (error) {
		return {
			valid: false,
			error: '⚠️ Неверный формат даты. Пожалуйста, укажите дату правильно.'
		}
	}
}

// Валидация времени (рабочие часы салона)
async function validateBookingTime(time) {
	try {
		const [hours, minutes] = time.split(':').map(Number)
		
		// Проверка формата
		if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
			return {
				valid: false,
				error: '⚠️ Неверный формат времени. Используйте формат ЧЧ:ММ (например, 14:30).'
			}
		}
		
		// Рабочие часы салона: 10:00 - 21:00
		const SALON_OPEN = 10;
		const SALON_CLOSE = 21;
		
		if (hours < SALON_OPEN || hours >= SALON_CLOSE) {
			// Log rejection for observability
			await logRejection(pool, 'SYSTEM', 'OUTSIDE_WORKING_HOURS', { attempted_time: time });
			return {
				valid: false,
				error: `⚠️ Салон работает с ${SALON_OPEN}:00 до ${SALON_CLOSE}:00. Пожалуйста, выберите время в этом диапазоне.`
			}
		}
		
		return { valid: true }
	} catch (error) {
		return {
			valid: false,
			error: '⚠️ Ошибка обработки времени. Пожалуйста, укажите время в формате ЧЧ:ММ.'
		}
	}
}

// Проверка доступности мастера (расписание, выходные)
async function checkMasterAvailability(masterName, date, time) {
	// В будущем здесь можно добавить проверку индивидуального графика мастеров
	// Пока все мастера работают по общему графику салона
	
	const dateValidation = validateBookingDate(date)
	if (!dateValidation.valid) {
		return dateValidation
	}
	
	const timeValidation = validateBookingTime(time)
	if (!timeValidation.valid) {
		return timeValidation
	}
	
	// Проверка что мастер существует
	const master = SALON_DATA.masters.find(m => m.name === masterName)
	if (!master) {
		return {
			valid: false,
			error: `⚠️ Мастер ${masterName} не найден. Пожалуйста, выберите мастера из списка.`
		}
	}
	
	return { valid: true }
}

// Проверка конфликтов у клиента (нет записи на то же время)
async function checkClientConflicts(userId, date, time, excludeBookingId = null) {
	try {
		const query = excludeBookingId
			? `SELECT id, service, master, time FROM bookings 
			   WHERE user_id = $1 AND date = $2 AND status IN ('confirmed', 'pending') AND id != $3`
			: `SELECT id, service, master, time FROM bookings 
			   WHERE user_id = $1 AND date = $2 AND status IN ('confirmed', 'pending')`
		
		const params = excludeBookingId ? [userId, date, excludeBookingId] : [userId, date]
		const result = await pool.query(query, params)
		
		if (result.rows.length > 0) {
			const existingBooking = result.rows[0]
			const existingTime = typeof existingBooking.time === 'string' 
				? existingBooking.time.substring(0, 5) 
				: existingBooking.time
			
			return {
				valid: false,
				error: `⚠️ У вас уже есть запись на ${formatDateForDisplay(date)}:\n📋 ${existingBooking.service}\n👤 Мастер: ${existingBooking.master}\n🕐 Время: ${existingTime}\n\nПожалуйста, выберите другую дату или отмените существующую запись.`
			}
		}
		
		return { valid: true }
	} catch (error) {
		console.error('❌ Ошибка проверки конфликтов клиента:', error)
		return { valid: true } // В случае ошибки разрешаем продолжить
	}
}

// Комплексная валидация данных записи
async function validateBookingData(bookingData, userId) {
	const errors = []
	
	// Проверка всех обязательных полей
	if (!bookingData.service) errors.push('услуга')
	if (!bookingData.master) errors.push('мастер')
	if (!bookingData.price) errors.push('цена')
	if (!bookingData.date) errors.push('дата')
	if (!bookingData.time) errors.push('время')
	
	if (errors.length > 0) {
		// Log rejection for observability
		await logRejection(pool, userId, 'INCOMPLETE_DATA', { missing_fields: errors });
		return {
			valid: false,
			error: `⚠️ Не указаны следующие данные: ${errors.join(', ')}. Пожалуйста, уточните детали записи.`
		}
	}
	
	// Валидация даты
	const dateValidation = validateBookingDate(bookingData.date)
	if (!dateValidation.valid) {
		return dateValidation
	}
	
	// Валидация времени
	const timeValidation = validateBookingTime(bookingData.time)
	if (!timeValidation.valid) {
		return timeValidation
	}
	
	// Проверка доступности мастера
	const masterValidation = await checkMasterAvailability(
		bookingData.master,
		bookingData.date,
		bookingData.time
	)
	if (!masterValidation.valid) {
		return masterValidation
	}
	
	// Проверка конфликтов у клиента
	const clientConflicts = await checkClientConflicts(
		userId,
		bookingData.date,
		bookingData.time
	)
	if (!clientConflicts.valid) {
		return clientConflicts
	}
	
	return { valid: true }
}

// Проверка занятости слота через таблицу bookings
async function checkAvailability(masterName, date, time, durationMinutes = 60) {
	if (!masterName || !date || !time) return true

	try {
		// Приводим время к формату HH:MM
		let checkTime = time
		if (typeof time === 'string' && time.length > 5) {
			checkTime = time.substring(0, 5)
		}

		// Проверка на прошедшее время
		// Нормализация даты для проверки
		let dateStr = date
		if (date instanceof Date) {
			dateStr = date.toISOString().split('T')[0]
		}
		
		const bookingDateTime = new Date(`${dateStr}T${checkTime}:00`)
		const now = new Date()
		
		if (bookingDateTime < now) {
			console.log(`⛔ Попытка записи на прошедшее время: ${dateStr} ${checkTime}`)
			return false
		}

		// SQL для поиска пересечений с учетом длительности услуги
		// Проверяем записи со статусом 'confirmed' и 'pending'
		const result = await pool.query(
			`
      SELECT id, service, time, 
             COALESCE(duration, 60) as duration
      FROM bookings 
      WHERE status IN ('confirmed', 'pending')
      AND master = $1 
      AND date = $2
      AND (
          -- Проверяем пересечение временных интервалов
          (time, (COALESCE(duration, 60) || ' minutes')::interval) OVERLAPS 
          ($3::time, ($4 || ' minutes')::interval)
      )
      `,
			[masterName, date, checkTime, durationMinutes]
		)

		if (result.rows.length > 0) {
			console.log(`⛔ Время занято: ${masterName} ${date} ${checkTime}`)
			console.log(
				`   Конфликт с записью #${result.rows[0].id}: ${result.rows[0].service}`
			)
			return false
		}

		console.log(`✅ Время свободно: ${masterName} ${date} ${checkTime}`)
		return true
	} catch (error) {
		console.error('❌ Ошибка проверки доступности:', error)
		return false // При ошибке считаем время занятым (безопаснее)
	}
}
// Получение свободных временных окон для мастера на дату
async function getAvailableSlots(masterName, date, durationMinutes = 60) {
	try {
		// Рабочие часы салона: 10:00 - 21:00
		const workStart = 10
		const workEnd = 21
		const slotDuration = 60 // Проверяем слоты по 60 минут

		// Получаем все записи мастера на эту дату
		const result = await pool.query(
			`SELECT time, COALESCE(duration, 60) as duration
       FROM bookings 
       WHERE master = $1 
       AND date = $2 
       AND status IN ('confirmed', 'pending')
       ORDER BY time`,
			[masterName, date]
		)

		const bookedSlots = result.rows
		const availableSlots = []

		// Проверяем каждый час с 10:00 до 21:00
		for (let hour = workStart; hour < workEnd; hour++) {
			const slotTime = `${String(hour).padStart(2, '0')}:00`

			// Проверяем, свободен ли этот слот
			const isSlotFree = await checkAvailability(
				masterName,
				date,
				slotTime,
				slotDuration
			)

			if (isSlotFree) {
				availableSlots.push(slotTime)
			}
		}

		return availableSlots
	} catch (error) {
		console.error('❌ Ошибка получения свободных окон:', error)
		return []
	}
}
// Инициация подтверждения записи (АВТОМАТИЧЕСКОЕ СОЗДАНИЕ)
async function initiateBookingConfirmation(msg, sock, conversation, bookingData) {
	const userId = msg.key.remoteJid
	
	// Используем сохраненный телефон из разговора
	const clientPhone = conversation.client_phone || (await extractPhoneNumber(userId))
	
	// Используем имя из conversation
	let clientName = conversation.client_name
	if (!clientName || clientName === 'Клиент') {
		try {
			const result = await pool.query(
				'SELECT name FROM clients WHERE phone = $1',
				[clientPhone]
			)
			if (result.rows.length > 0 && result.rows[0].name) {
				clientName = result.rows[0].name
			} else {
				clientName = 'Клиент'
			}
		} catch (error) {
			console.error('Ошибка получения имени клиента:', error)
			clientName = 'Клиент'
		}
	}

	let client
	try {
		// ===== ЭТАП 1: КОМПЛЕКСНАЯ ВАЛИДАЦИЯ =====
		console.log(`\n📋 ===== СОЗДАНИЕ ЗАПИСИ =====`)
		console.log(`👤 Клиент: ${clientName} (${clientPhone})`)
		console.log(`📋 Услуга: ${bookingData.service}`)
		console.log(`👨‍💼 Мастер: ${bookingData.master}`)
		console.log(`💰 Цена: ${bookingData.price} тг`)
		console.log(`📅 Дата: ${bookingData.date}`)
		console.log(`🕐 Время: ${bookingData.time}`)
		
		// 1.1 Rate Limiting: Проверка на спам
		const rateLimitCheck = await pool.query(
			`SELECT COUNT(*) FROM bookings 
			WHERE user_id = $1 
			AND created_at > NOW() - INTERVAL '1 hour'`,
			[userId]
		)

		if (parseInt(rateLimitCheck.rows[0].count) >= 5) {
			console.log(`⛔ Rate limit exceeded for ${userId}`)
			return await replyMessage(sock, msg, 
				'⚠️ Вы создали слишком много заявок за последний час. Пожалуйста, подождите немного.'
			)
		}

		// 1.2 Проверка на дубликаты (та же запись создана менее 5 минут назад)
		const duplicateCheck = await pool.query(
			`SELECT id FROM bookings 
			WHERE user_id = $1 
			AND master = $2 
			AND date = $3 
			AND time = $4 
			AND status IN ('confirmed', 'pending')
			AND created_at > NOW() - INTERVAL '5 minutes'
			LIMIT 1`,
			[userId, bookingData.master, bookingData.date, bookingData.time]
		)

		if (duplicateCheck.rows.length > 0) {
			const existingId = duplicateCheck.rows[0].id
			console.log(`⚠️ Обнаружена попытка дублирования записи #${existingId}`)
			return await replyMessage(sock, msg, 
				`⚠️ Такая запись уже создана (№${existingId})!\n\nЕсли вы хотите изменить запись, сначала отмените существующую.`
			)
		}

		// 1.3 Валидация всех данных
		const validation = await validateBookingData(bookingData, userId)
		if (!validation.valid) {
			console.log(`❌ Валидация не пройдена: ${validation.error}`)
			return await replyMessage(sock, msg, validation.error)
		}

		// 1.4 Определение длительности услуги
		const serviceObj = SALON_DATA.services.find(
			s => s.name === bookingData.service && 
			(s.master === bookingData.master || s.master === 'другие')
		)
		const serviceDuration = serviceObj ? serviceObj.duration : 60

		console.log(`⏱️ Длительность услуги: ${serviceDuration} минут`)

		// 1.5 Финальная проверка доступности
		const isFree = await checkAvailability(
			bookingData.master,
			bookingData.date,
			bookingData.time,
			serviceDuration
		)

		if (!isFree) {
			console.log(`⛔ Слот занят при финальной проверке`)
			
			const availableSlots = await getAvailableSlots(
				bookingData.master,
				bookingData.date
			)

			let alternativeMessage = `⚠️ Извините, время ${bookingData.time} на ${formatDateForDisplay(bookingData.date)} к мастеру ${bookingData.master} уже занято! 😔`

			if (availableSlots.length > 0) {
				const slotsText = availableSlots
					.slice(0, 5)
					.map(time => `• ${time}`)
					.join('\n')
				alternativeMessage += `\n\n✨ Доступное время на эту дату:\n${slotsText}\n\nВыберите другое время!`
			} else {
				alternativeMessage += `\n\nК сожалению, на эту дату все занято. Попробуйте выбрать другой день! 🤍`
			}

			return await replyMessage(sock, msg, alternativeMessage)
		}

		// ===== ЭТАП 2: АТОМАРНОЕ СОЗДАНИЕ ЗАПИСИ =====
		client = await pool.connect()
		await client.query('BEGIN')

		console.log(`\n🔒 Начало транзакции создания записи...`)

		// 2.1 Еще раз проверяем доступность с блокировкой строк
		const lockCheck = await client.query(
			`SELECT id FROM bookings 
			WHERE master = $1 
			AND date = $2 
			AND status IN ('confirmed', 'pending')
			AND (time, (COALESCE(duration, 60) || ' minutes')::interval) OVERLAPS 
				($3::time, ($4 || ' minutes')::interval)
			FOR UPDATE`,
			[bookingData.master, bookingData.date, bookingData.time, serviceDuration]
		)

		if (lockCheck.rows.length > 0) {
			await client.query('ROLLBACK')
			console.log(`⛔ Конфликт обнаружен при блокировке (race condition предотвращен)`)
			return await replyMessage(sock, msg, 
				`⚠️ К сожалению, это время только что заняли. Пожалуйста, выберите другое время.`
			)
		}

		// 2.2 Создаем запись со статусом 'confirmed' (АВТОМАТИЧЕСКОЕ ПОДТВЕРЖДЕНИЕ)
		// Генерируем idempotency key для защиты от дубликатов
		const idempotencyKey = generateIdempotencyKey(
			userId,
			bookingData.master,
			bookingData.date,
			bookingData.time,
			bookingData.service
		);
		console.log(`🔑 Idempotency key: ${idempotencyKey}`);

		const result = await client.query(
			`INSERT INTO bookings (
				user_id, client_name, client_phone, service, master, 
				price, date, time, duration, status, confirmed_at, idempotency_key
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'confirmed', CURRENT_TIMESTAMP, $10)
			ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
			DO UPDATE SET updated_at = CURRENT_TIMESTAMP
			RETURNING id, (xmax = 0) AS is_new`,
			[
				userId,
				clientName,
				clientPhone,
				bookingData.service,
				bookingData.master,
				bookingData.price,
				bookingData.date,
				bookingData.time,
				serviceDuration,
				idempotencyKey
			]
		)

		const bookingId = result.rows[0].id
		const isNewBooking = result.rows[0].is_new

		// Если это дубликат (idempotent request), возвращаем существующую запись
		if (!isNewBooking) {
			console.log(`⚠️ Идемпотентный запрос: запись #${bookingId} уже существует`);
			await logRejection(pool, userId, 'DUPLICATE_BOOKING', { 
				existing_booking_id: bookingId,
				idempotency_key: idempotencyKey 
			});
			await client.query('COMMIT');
			
			return await replyMessage(sock, msg, 
				`✅ Ваша запись #${bookingId} уже подтверждена!\n\n` +
				`📋 ${bookingData.service}\n` +
				`👤 Мастер: ${bookingData.master}\n` +
				`📅 ${formatDateForDisplay(bookingData.date)}\n` +
				`🕐 ${bookingData.time}\n\n` +
				`Ждём вас! ✨`
			);
		}

		// 2.3 Логируем создание
		await client.query(
			`INSERT INTO booking_logs (booking_id, action, details, user_id)
			VALUES ($1, $2, $3, $4)`,
			[
				bookingId,
				'created',
				JSON.stringify({
					service: bookingData.service,
					master: bookingData.master,
					date: bookingData.date,
					time: bookingData.time,
					price: bookingData.price,
					duration: serviceDuration,
					auto_confirmed: true
				}),
				userId
			]
		)

		// 2.4 Сохраняем/обновляем клиента
		await client.query(
			`INSERT INTO clients (phone, name, user_id, created_at)
			VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
			ON CONFLICT (phone) 
			DO UPDATE SET 
				name = EXCLUDED.name,
				user_id = EXCLUDED.user_id`,
			[clientPhone, clientName, userId]
		)

		await client.query('COMMIT')
		console.log(`✅ Транзакция завершена успешно`)
		console.log(`✅ Запись #${bookingId} создана и АВТОМАТИЧЕСКИ ПОДТВЕРЖДЕНА`)

		// ===== ЭТАП 3: POST-COMMIT ДЕЙСТВИЯ =====
		
		// 3.1 Обновляем conversation
		conversation.booking_data = {
			...bookingData,
			id: bookingId,
			duration: serviceDuration,
		}

		conversation.history.push({
			role: 'assistant',
			content: `СИСТЕМНОЕ СООБЩЕНИЕ: Запись #${bookingId} успешно создана и подтверждена. Ожидание новой команды.`,
			timestamp: new Date().toISOString(),
		})

		await saveConversation(conversation)

		// 3.2 Уведомление клиента (БЕЗ упоминания "ожидания администратора")
		await replyMessage(sock, msg, 
			`✅ Отлично, ${clientName}! Ваша запись подтверждена! ✨\n\n📋 Услуга: ${bookingData.service}\n👤 Мастер: ${bookingData.master}\n💰 Цена: ${bookingData.price} тг\n⏱️ Длительность: ${serviceDuration} мин\n📅 Дата: ${formatDateForDisplay(bookingData.date)}\n🕐 Время: ${bookingData.time}\n📍 Адрес: ${CONFIG.SALON_ADDRESS}\n\nЖдём вас в ${CONFIG.SALON_NAME}! 🤍\n\nЗа день до визита мы отправим вам напоминание.`
		)

		// 3.3 Уведомление админов (только информирование, без кнопок)
		await notifyAdminsNewBooking(sock, bookingId)

		// 3.4 Добавление в Google Calendar
		try {
			await addToCalendar({
				id: bookingId,
				client_name: clientName,
				client_phone: clientPhone,
				service: bookingData.service,
				master: bookingData.master,
				price: bookingData.price,
				date: bookingData.date,
				time: bookingData.time,
			})
		} catch (calError) {
			console.error('⚠️ Ошибка добавления в календарь:', calError)
			// Не блокируем создание записи если календарь не работает
		}

		// 3.5 Обновление статистики
		try {
			await updateStatistics({
				master: bookingData.master,
				price: bookingData.price,
				client_phone: clientPhone
			})
		} catch (statsError) {
			console.error('⚠️ Ошибка обновления статистики:', statsError)
		}

		console.log(`\n✅ ===== ЗАПИСЬ #${bookingId} УСПЕШНО СОЗДАНА =====\n`)

	} catch (error) {
		if (client) {
			await client.query('ROLLBACK')
			console.log(`🔙 Транзакция отменена из-за ошибки`)
		}
		
		console.error('❌ Ошибка создания записи:', error)
		console.error('Детали ошибки:', error.stack)
		
		await replyMessage(sock, msg, 
			'Произошла ошибка при создании записи. Пожалуйста, попробуйте еще раз или свяжитесь с администратором.'
		)
	} finally {
		if (client) {
			client.release()
		}
	}
}

// Уведомление администраторов о новой записи (БЕЗ КНОПОК ПОДТВЕРЖДЕНИЯ)
async function notifyAdminsNewBooking(sock, bookingId) {
	try {
		const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [
			bookingId,
		])
		const booking = result.rows[0]

		if (!booking) return

		// Форматирование даты
		const dateObj =
			typeof booking.date === 'string'
				? new Date(booking.date + 'T00:00:00')
				: booking.date
		const formattedDate = dateObj.toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		})

		// Форматирование времени (убираем секунды)
		let formattedTime = booking.time
		if (typeof booking.time === 'object') {
			// Если это объект Time из PostgreSQL
			const hours = String(booking.time.hours || 0).padStart(2, '0')
			const minutes = String(booking.time.minutes || 0).padStart(2, '0')
			formattedTime = `${hours}:${minutes}`
		} else if (typeof booking.time === 'string') {
			// Если это строка "14:00:00"
			formattedTime = booking.time.substring(0, 5)
		}

		const adminMessage = `✅ НОВАЯ ЗАПИСЬ #${booking.id} 

👤 Клиент: ${booking.client_name}
📱 Телефон: ${booking.client_phone}

📋 Услуга: ${booking.service}
👨‍💼 Мастер: ${booking.master}
💰 Цена: ${booking.price} тг
⏱️ Длительность: ${booking.duration || 60} мин
📅 Дата: ${formattedDate}
🕐 Время: ${formattedTime}

Для отмены: /cancel ${booking.id}`

		for (const adminId of CONFIG.ADMIN_WHITELIST) {
			try {
				await sendMessage(sock, adminId, adminMessage)
				console.log(`✅ Уведомление отправлено админу: ${adminId}`)
			} catch (error) {
				console.error(`❌ Ошибка отправки админу ${adminId}:`, error)
			}
		}
	} catch (error) {
		console.error('Ошибка уведомления админов:', error)
	}
}

// Функция детекции отмены
// Функция детекции отмены
async function detectCancellation(userId, messageText, sock) {
	const lower = messageText.toLowerCase().trim()

	// Ключевые слова отмены
	const cancelKeywords = [
		'отмени',
		'отмена',
		'передумал',
		'передумала',
		'не хочу',
		'удали запись',
		'не приду',
		'отменить',
		'сброс',
	]

	if (cancelKeywords.some(w => lower.includes(w))) {
		console.log(`🚫 Обнаружена попытка отмены от ${userId}: "${messageText}"`)

		try {
			// Ищем активные записи (pending или confirmed)
			const res = await pool.query(
				`SELECT id, status, service, date, time FROM bookings 
         WHERE user_id = $1 AND status IN ('pending', 'confirmed')
         ORDER BY created_at DESC LIMIT 1`,
				[userId]
			)

			if (res.rows.length > 0) {
				const booking = res.rows[0]

				// Отменяем запись
				await pool.query(
					"UPDATE bookings SET status = 'cancelled' WHERE id = $1",
					[booking.id]
				)

				console.log(
					`🚫 Запись #${booking.id} (${booking.status}) отменена пользователем`
				)

				// Уведомляем админов если запись была подтверждена
				if (booking.status === 'confirmed') {
					await notifyAdminsCancellation(sock, booking.id, booking)
				}

				return true
			} else {
				console.log(
					`⚠️ У пользователя ${userId} нет активных записей для отмены`
				)
				// Сбрасываем сессию на всякий случай
				await resetSession(userId, true)
				return true // Возвращаем true чтобы показать что обработали намерение
			}
		} catch (e) {
			console.error('Ошибка при отмене:', e)
		}
	}
	return false
}

// Уведомление об отмене (улучшенное)
async function notifyAdminsCancellation(sock, bookingId, booking) {
	for (const adminId of CONFIG.ADMIN_WHITELIST) {
		try {
			await sendMessage(sock, 
				adminId,
				`⚠️ ОТМЕНА ЗАПИСИ #${bookingId}\n\nКлиент отменил подтвержденную запись:\n📋 ${booking.service}\n📅 ${booking.date}\n🕐 ${booking.time}`
			)
		} catch (e) {
			console.error(`Ошибка уведомления админа ${adminId}:`, e)
		}
	}
}



// Обработка ответа администратора
async function confirmBooking(msg, sock, command) {
	const bookingId = command.split(' ')[1]

	try {
		const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [
			bookingId,
		])
		const booking = result.rows[0]

		if (!booking) {
			return await replyMessage(sock, msg, '❌ Запись не найдена')
		}

		if (booking.status === 'confirmed') {
			return await replyMessage(sock, msg, `⚠️ Запись #${bookingId} уже подтверждена`)
		}

		if (booking.status === 'rejected') {
			return await replyMessage(sock, msg, `⚠️ Запись #${bookingId} была отклонена`)
		}

		await pool.query(
			'UPDATE bookings SET status = $1, confirmed_at = CURRENT_TIMESTAMP WHERE id = $2',
			['confirmed', bookingId]
		)

		// Сразу отвечаем админу, чтобы не ждать остальные операции
		await replyMessage(sock, msg, 
			`✅ Запись #${bookingId} подтверждена\nКлиент ${booking.client_name} уведомлен`
		)

		// Добавление в календарь
		await addToCalendar(booking)

		// Обновление статистики
		await updateStatistics(booking)

		// Форматирование даты для сообщения
		const dateObj =
			typeof booking.date === 'string'
				? new Date(booking.date + 'T00:00:00')
				: booking.date
		const formattedDate = dateObj.toLocaleDateString('ru-RU', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		})

		// Форматирование времени
		let formattedTime = String(booking.time)
		if (typeof booking.time === 'object') {
			const hours = String(booking.time.hours || 0).padStart(2, '0')
			const minutes = String(booking.time.minutes || 0).padStart(2, '0')
			formattedTime = `${hours}:${minutes}`
		} else {
			formattedTime = formattedTime.substring(0, 5)
		}

		await sendMessage(sock, 
			booking.user_id,
			`✅ Ваша запись подтверждена!\n\n📋 ${booking.service}\n👤 Мастер: ${booking.master}\n💰 ${booking.price} тг\n📅 ${formattedDate}\n🕐 ${formattedTime}\n\nЖдем вас в ${CONFIG.SALON_NAME}! ✨`
		)

		// Добавляем системное сообщение в историю, чтобы бот знал, что запись создана
		try {
			const conversation = await getConversation(booking.user_id)
			if (conversation) {
				conversation.history.push({
					role: 'assistant',
					content: `СИСТЕМНОЕ СООБЩЕНИЕ: Запись #${bookingId} успешно создана. Ожидание новой команды.`,
					timestamp: new Date().toISOString(),
				})
				await saveConversation(conversation)
			}
		} catch (e) {
			console.error('Ошибка обновления истории после подтверждения:', e)
		}
	} catch (error) {
		console.error('Ошибка подтверждения:', error)
		await replyMessage(sock, msg, 'Произошла ошибка при подтверждении')
	}
}

async function rejectBooking(msg, sock, command) {
	const bookingId = command.split(' ')[1]

	try {
		const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [
			bookingId,
		])
		const booking = result.rows[0]

		if (!booking) {
			return await replyMessage(sock, msg, '❌ Запись не найдена')
		}

		if (booking.status === 'confirmed') {
			return await replyMessage(sock, msg, `⚠️ Запись #${bookingId} уже подтверждена`)
		}

		if (booking.status === 'rejected') {
			return await replyMessage(sock, msg, `⚠️ Запись #${bookingId} уже отклонена`)
		}

		await pool.query('UPDATE bookings SET status = $1 WHERE id = $2', [
			'rejected',
			bookingId,
		])

		// Сразу отвечаем админу
		await replyMessage(sock, msg, 
			`❌ Запись #${bookingId} отклонена\nКлиент ${booking.client_name} уведомлен`
		)

		// Уведомление клиента
		// Уведомление клиента
		await sendMessage(sock, 
			booking.user_id,
			`К сожалению, не можем подтвердить запись на это время 😔\n\nПожалуйста, выберите другое время! Напишите нам снова 🤍`
		)
	} catch (error) {
		console.error('Ошибка отклонения:', error)
		await replyMessage(sock, msg, 'Произошла ошибка при отклонении')
	}
}

// Добавление в Google Calendar
async function addToCalendar(booking) {
	if (!calendar) {
		console.log('⚠️ Google Calendar не настроен')
		return
	}

	try {
		// Нормализация даты (YYYY-MM-DD)
		let dateStr = ''
		if (booking.date instanceof Date) {
			const year = booking.date.getFullYear()
			const month = String(booking.date.getMonth() + 1).padStart(2, '0')
			const day = String(booking.date.getDate()).padStart(2, '0')
			dateStr = `${year}-${month}-${day}`
		} else {
			// Если строка, предполагаем YYYY-MM-DD, берем первые 10 символов
			dateStr = String(booking.date).substring(0, 10)
		}

		// Нормализация времени (HH:MM)
		let timeStr = ''
		if (typeof booking.time === 'object') {
			const hours = String(booking.time.hours || 0).padStart(2, '0')
			const minutes = String(booking.time.minutes || 0).padStart(2, '0')
			timeStr = `${hours}:${minutes}`
		} else {
			timeStr = String(booking.time).substring(0, 5)
		}

		const startDate = new Date(`${dateStr}T${timeStr}:00`)
		const endDate = new Date(startDate.getTime() + 90 * 60000)

		const event = {
			summary: `${booking.service} - ${booking.master}`,
			description: `Клиент: ${
				booking.client_name || booking.user_id
			}\nТелефон: ${booking.client_phone}`,
			start: {
				dateTime: startDate.toISOString(),
				timeZone: 'Asia/Almaty',
			},
			end: {
				dateTime: endDate.toISOString(),
				timeZone: 'Asia/Almaty',
			},
			reminders: {
				useDefault: false,
				overrides: [
					{ method: 'popup', minutes: 60 },
					{ method: 'popup', minutes: 1440 },
				],
			},
		}

		await calendar.events.insert({
			calendarId: CONFIG.CALENDAR_ID,
			resource: event,
		})

		console.log('✅ Запись добавлена в Google Calendar')
	} catch (error) {
		console.error('❌ Ошибка добавления в календарь:', error)
	}
}

// Обновление статистики
async function updateStatistics(booking) {
	try {
		await pool.query(
			`UPDATE statistics
			SET total_bookings = total_bookings + 1,
				confirmed_bookings = confirmed_bookings + 1,
				revenue = revenue + $1,
				updated_at = CURRENT_TIMESTAMP
			WHERE master_name = $2`,
			[booking.price, booking.master]
		)

		// Обновление данных клиента
		await pool.query(
			`UPDATE clients
			SET total_visits = total_visits + 1,
				total_spent = total_spent + $1,
				last_visit = CURRENT_TIMESTAMP
			WHERE phone = $2`,
			[booking.price, booking.client_phone]
		)

		console.log(`✅ Статистика обновлена для ${booking.master}`)
	} catch (error) {
		console.error('Ошибка обновления статистики:', error)
	}
}

// Отправка статистики
async function sendAdminStats(msg, sock) {
	try {
		const result = await pool.query(
			'SELECT * FROM statistics ORDER BY revenue DESC'
		)
		let statsText = `📊 СТАТИСТИКА САЛОНА\n\n`

		result.rows.forEach(stats => {
			statsText += `👤 ${stats.master_name}\n`
			statsText += `   📝 Всего записей: ${stats.total_bookings}\n`
			statsText += `   ✅ Подтверждено: ${stats.confirmed_bookings}\n`
			statsText += `   💰 Доход: ${stats.revenue.toLocaleString()} тг\n\n`
		})

		// Общая статистика
		const totalRevenue = result.rows.reduce(
			(sum, s) => sum + parseInt(s.revenue),
			0
		)
		const totalBookings = result.rows.reduce(
			(sum, s) => sum + parseInt(s.total_bookings),
			0
		)

		const conversationsCount = await pool.query(
			'SELECT COUNT(*) FROM conversations'
		)

		statsText += `📈 ОБЩАЯ СТАТИСТИКА\n`
		statsText += `Всего записей: ${totalBookings}\n`
		statsText += `Общий доход: ${totalRevenue.toLocaleString()} тг\n`
		statsText += `Активных диалогов: ${conversationsCount.rows[0].count}`

		await replyMessage(sock, msg, statsText)
	} catch (error) {
		console.error('Ошибка получения статистики:', error)
		await replyMessage(sock, msg, 'Ошибка получения статистики')
	}
}
// ===================== СИСТЕМА НАПОМИНАНИЙ (УЛУЧШЕННАЯ) =====================
function startReminderScheduler() {
	const cron = require('node-cron')

	// Проверка каждые 30 минут
	cron.schedule('*/30 * * * *', async () => {
		try {
			const now = new Date()

			// ===== НАПОМИНАНИЯ ЗА 24 ЧАСА =====
			const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60 * 1000)
			const twentyFourHoursWindow = new Date(now.getTime() + 24.5 * 60 * 60 * 1000)

			const reminder24h = await pool.query(
				`SELECT * FROM bookings 
				WHERE status = 'confirmed' 
				AND reminder_24h_sent = FALSE 
				AND date::timestamp + time::interval BETWEEN $1 AND $2`,
				[twentyFourHoursLater.toISOString(), twentyFourHoursWindow.toISOString()]
			)

			console.log(`⏰ Проверка напоминаний за 24 часа: найдено ${reminder24h.rows.length} записей`)

			for (const booking of reminder24h.rows) {
				try {
					const formattedTime = typeof booking.time === 'string' 
						? booking.time.substring(0, 5) 
						: booking.time
					
					const bookingDate = new Date(booking.date)
					const formattedDate = bookingDate.toLocaleDateString('ru-RU', {
						day: 'numeric',
						month: 'long',
						weekday: 'long'
					})

					await sendMessage(sock, 
						booking.user_id,
						`⏰ НАПОМИНАНИЕ О ЗАПИСИ\n\nЗдравствуйте, ${booking.client_name}!\n\nНапоминаем, что завтра в ${formattedTime} у вас запись:\n\n📋 ${booking.service}\n👤 Мастер: ${booking.master}\n📅 ${formattedDate}\n📍 Адрес: ${CONFIG.SALON_ADDRESS}\n\nЖдём вас! ✨\n\nЕсли нужно отменить или перенести запись, напишите нам.`
					)

					await pool.query(
						'UPDATE bookings SET reminder_24h_sent = TRUE WHERE id = $1',
						[booking.id]
					)

					await logBookingAction(booking.id, 'reminder_24h_sent', {
						sent_at: new Date().toISOString(),
						client_name: booking.client_name
					}, booking.user_id)

					console.log(`✅ Напоминание за 24ч отправлено: ${booking.client_name} (запись #${booking.id})`)
				} catch (error) {
					console.error(`Ошибка отправки напоминания за 24ч для записи #${booking.id}:`, error)
				}
			}

			// ===== НАПОМИНАНИЯ ЗА 2-3 ЧАСА =====
			const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000)
			const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000)

			const reminder3h = await pool.query(
				`SELECT * FROM bookings 
				WHERE status = 'confirmed' 
				AND reminder_3h_sent = FALSE 
				AND date::timestamp + time::interval BETWEEN $1 AND $2`,
				[twoHoursLater.toISOString(), threeHoursLater.toISOString()]
			)

			console.log(`⏰ Проверка напоминаний за 2-3 часа: найдено ${reminder3h.rows.length} записей`)

			for (const booking of reminder3h.rows) {
				try {
					const formattedTime = typeof booking.time === 'string' 
						? booking.time.substring(0, 5) 
						: booking.time

					await sendMessage(sock, 
						booking.user_id,
						`⏰ НАПОМИНАНИЕ О ЗАПИСИ\n\nЗдравствуйте, ${booking.client_name}!\n\nНапоминаем, что сегодня в ${formattedTime} у вас запись:\n\n📋 ${booking.service}\n👤 Мастер: ${booking.master}\n📍 Адрес: ${CONFIG.SALON_ADDRESS}\n\nЖдём вас! ✨`
					)

					await pool.query(
						'UPDATE bookings SET reminder_3h_sent = TRUE WHERE id = $1',
						[booking.id]
					)

					await logBookingAction(booking.id, 'reminder_3h_sent', {
						sent_at: new Date().toISOString(),
						client_name: booking.client_name
					}, booking.user_id)

					console.log(`✅ Напоминание за 3ч отправлено: ${booking.client_name} (запись #${booking.id})`)
				} catch (error) {
					console.error(`Ошибка отправки напоминания за 3ч для записи #${booking.id}:`, error)
				}
			}
		} catch (error) {
			console.error('❌ Ошибка в системе напоминаний:', error)
		}
	})

	console.log('✅ Улучшенная система напоминаний запущена (проверка каждые 30 минут)')
	console.log('   - Напоминания за 24 часа')
	console.log('   - Напоминания за 2-3 часа')
}
// ===================== ПЛАНИРОВЩИК ОЧИСТКИ СЕССИЙ =====================
function startSessionCleanup() {
	const cron = require('node-cron')

	// Проверка каждые 15 минут
	cron.schedule('*/15 * * * *', async () => {
		try {
			console.log('🧹 Проверка истекших сессий (фоновая очистка)...')

			// Находим все сессии старше 30 минут которые НЕ в стадии greeting
			const expiredSessions = await pool.query(
				`SELECT user_id, client_name, updated_at, stage
         FROM conversations 
         WHERE updated_at < NOW() - INTERVAL '30 minutes'
         AND stage != 'greeting'`
			)

			if (expiredSessions.rows.length > 0) {
				console.log(
					`⏰ Найдено ${expiredSessions.rows.length} истекших сессий для фоновой очистки`
				)

				for (const session of expiredSessions.rows) {
					// Только сбрасываем без уведомления (фоновая очистка)
					await resetSession(session.user_id, true)

					console.log(
						`✅ Фоновая очистка сессии: ${
							session.client_name || session.user_id
						} (неактивна ${Math.round(
							(Date.now() - new Date(session.updated_at)) / (1000 * 60)
						)} мин)`
					)
				}
			} else {
				console.log('✅ Истекших сессий не найдено')
			}
		} catch (error) {
			console.error('❌ Ошибка фоновой очистки сессий:', error)
		}
	})

	console.log(
		'✅ Планировщик фоновой очистки сессий запущен (проверка каждые 15 минут)'
	)
}
// ===================== ЗАПУСК БОТА =====================
async function startBot() {
	console.log('🚀 Запуск бота La Mirage...')

	validateConfig()
	await initDatabase()
	initVertexAI()
	await initGoogleCalendar()
	await initWhatsApp()

	// Запуск системы напоминаний
	startSessionCleanup()
}

if (CONFIG.NODE_ENV !== 'test' && require.main === module) {
	startBot().catch(console.error)
}
// Обработка выхода
process.on('SIGINT', async () => {
	console.log('\n👋 Остановка бота...')
	try {
		if (whatsappClient && typeof whatsappClient.end === 'function') {
			await whatsappClient.end()
		}
		if (pool) await pool.end()
		process.exit(0)
	} catch (error) {
		console.error('Ошибка при остановке:', error.message)
		process.exit(1)
	}
})

module.exports = {
	CONFIG,
	SALON_DATA,
	MASTERS,
	PRICES,
	initDatabase,
	startBot,
	checkAvailability,
	getAvailableSlots,
	checkSessionExpiry, // НОВОЕ
	resetSession, // НОВОЕ
	notifySessionExpired, // НОВОЕ
}
