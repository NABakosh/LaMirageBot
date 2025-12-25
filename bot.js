// WhatsApp Bot для салона красоты La Mirage by Yuna Khairullina
// Требуется установка: npm install whatsapp-web.js qrcode-terminal @google/generative-ai googleapis dotenv

require('dotenv').config()
const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const { google } = require('googleapis')
const fs = require('fs').promises

// ===================== КОНФИГУРАЦИЯ ИЗ .ENV =====================
const CONFIG = {
	GEMINI_API_KEY: process.env.GEMINI_API_KEY,
	GOOGLE_CALENDAR_CREDENTIALS:
		process.env.GOOGLE_CALENDAR_CREDENTIALS || './credentials.json',
	GOOGLE_CALENDAR_TOKEN: process.env.GOOGLE_CALENDAR_TOKEN || './token.json',
	CALENDAR_ID: process.env.CALENDAR_ID || 'primary',
	ADMIN_WHITELIST: process.env.ADMIN_WHITELIST
		? process.env.ADMIN_WHITELIST.split(',').map(n => n.trim())
		: [],
	SALON_NAME: process.env.SALON_NAME || 'La Mirage by Yuna Khairullina',
	INSTAGRAM_LINK: process.env.INSTAGRAM_LINK || '',
	SALON_ADDRESS: process.env.SALON_ADDRESS || '',
	WORKING_HOURS: process.env.WORKING_HOURS || 'Ежедневно с 10:00 до 21:00',
	NODE_ENV: process.env.NODE_ENV || 'development',
}

// Валидация обязательных переменных
function validateConfig() {
	const required = ['GEMINI_API_KEY']
	const missing = required.filter(key => !CONFIG[key])

	if (missing.length > 0) {
		console.error(
			'❌ Отсутствуют обязательные переменные окружения:',
			missing.join(', ')
		)
		console.error('Создайте файл .env и укажите необходимые параметры')
		process.exit(1)
	}

	if (CONFIG.ADMIN_WHITELIST.length === 0) {
		console.warn(
			'⚠️  ADMIN_WHITELIST пуст. Добавьте номера администраторов в .env'
		)
	}
}

// ===================== ДАННЫЕ О САЛОНЕ =====================
const SALON_DATA = {
	// Массив услуг - заполните своими данными
	services: [
		// Пример структуры:
		// { name: 'Маникюр классический', price: 5000, duration: 60 },
		// { name: 'Маникюр с покрытием', price: 7000, duration: 90 },
		// { name: 'Педикюр', price: 8000, duration: 90 },
		// { name: 'Наращивание ресниц классика', price: 12000, duration: 120 },
	],

	masters: [
		{ name: 'Юна', specialty: 'мастер по маникюру', available: true },
		{ name: 'Аружан', specialty: 'мастер по маникюру', available: true },
		{ name: 'Айлин', specialty: 'мастер по маникюру', available: true },
		{ name: 'Айгерим', specialty: 'мастер по маникюру', available: true },
		{ name: 'Гульназ', specialty: 'мастер по маникюру', available: true },
		{ name: 'Жазира', specialty: 'мастер по маникюру', available: true },
		{ name: 'Лена', specialty: 'мастер по ресницам', available: true },
	],

	materialInfo: {
		nails:
			'Мы работаем на профессиональных материалах премиум-класса: гель-лаки CND, Kodi, базы и топы Rubber Base. Все материалы гипоаллергенны и безопасны.',
		lashes:
			'Наращивание ресниц выполняется материалами премиум-класса с использованием гипоаллергенного клея.',
	},

	workingHours: CONFIG.WORKING_HOURS,
	address: CONFIG.SALON_ADDRESS,
}

// ===================== БАЗА ДАННЫХ (в памяти) =====================
const database = {
	conversations: new Map(), // userId -> conversation state
	bookings: [], // Все записи
	statistics: new Map(), // Статистика по мастерам
}

// ===================== ИНИЦИАЛИЗАЦИЯ СЕРВИСОВ =====================
let whatsappClient
let genAI
let calendarAuth
let calendar

// Инициализация Gemini AI
function initGemini() {
	try {
		genAI = new GoogleGenerativeAI(CONFIG.GEMINI_API_KEY)
		console.log('✅ Gemini AI инициализирован')
	} catch (error) {
		console.error('❌ Ошибка инициализации Gemini:', error.message)
		throw error
	}
}

// Инициализация Google Calendar
async function initGoogleCalendar() {
	try {
		const credentials = JSON.parse(
			await fs.readFile(CONFIG.GOOGLE_CALENDAR_CREDENTIALS, 'utf-8')
		)
		const { client_secret, client_id, redirect_uris } =
			credentials.installed || credentials.web

		const oAuth2Client = new google.auth.OAuth2(
			client_id,
			client_secret,
			redirect_uris[0]
		)

		try {
			const token = await fs.readFile(CONFIG.GOOGLE_CALENDAR_TOKEN, 'utf-8')
			oAuth2Client.setCredentials(JSON.parse(token))
		} catch (err) {
			console.log(
				'⚠️  Необходима авторизация Google Calendar. Следуйте инструкциям.'
			)
			await getAccessToken(oAuth2Client)
		}

		calendarAuth = oAuth2Client
		calendar = google.calendar({ version: 'v3', auth: oAuth2Client })
		console.log('✅ Google Calendar инициализирован')
	} catch (err) {
		console.error('❌ Ошибка инициализации Google Calendar:', err.message)
		console.log('ℹ️  Бот будет работать без интеграции с календарем')
	}
}

// Получение токена Google (первый запуск)
async function getAccessToken(oAuth2Client) {
	const authUrl = oAuth2Client.generateAuthUrl({
		access_type: 'offline',
		scope: ['https://www.googleapis.com/auth/calendar'],
	})

	console.log('Авторизуйтесь по ссылке:', authUrl)
	console.log('Введите код из браузера в переменную ниже и перезапустите бота.')
	// В продакшене используйте readline для ввода кода
}

// Инициализация WhatsApp клиента
function initWhatsApp() {
	whatsappClient = new Client({
		authStrategy: new LocalAuth(),
		puppeteer: {
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
		},
	})

	whatsappClient.on('qr', qr => {
		console.log('📱 Отсканируйте QR-код в WhatsApp:')
		qrcode.generate(qr, { small: true })
	})

	whatsappClient.on('ready', () => {
		console.log('✅ WhatsApp бот запущен!')
		console.log(`📞 Салон: ${CONFIG.SALON_NAME}`)
		console.log(`👥 Админов в whitelist: ${CONFIG.ADMIN_WHITELIST.length}`)
	})

	whatsappClient.on('message', handleMessage)

	whatsappClient.on('disconnected', reason => {
		console.log('⚠️  WhatsApp отключен:', reason)
	})

	whatsappClient.initialize()

	return whatsappClient
}

// ===================== ОБРАБОТКА СООБЩЕНИЙ =====================
async function handleMessage(message) {
	const userId = message.from
	const userMessage = message.body.trim()

	// Игнорируем сообщения от ботов и групп
	if (message.fromMe || message.from.includes('@g.us')) {
		return
	}

	// Проверка команд администратора
	if (CONFIG.ADMIN_WHITELIST.includes(userId)) {
		if (userMessage === '/admin') {
			await sendAdminStats(message)
			return
		}

		// Обработка подтверждения записи
		if (
			userMessage.startsWith('/confirm_') ||
			userMessage.startsWith('/reject_')
		) {
			await handleAdminResponse(message, userMessage)
			return
		}
	}

	// Получение или создание состояния разговора
	let conversation = database.conversations.get(userId)

	if (!conversation) {
		conversation = {
			stage: 'greeting',
			history: [],
			bookingData: {},
		}
		database.conversations.set(userId, conversation)

		// Отправка приветствия
		await sendGreeting(message)
		conversation.stage = 'conversation'
		return
	}

	// Добавление сообщения в историю
	conversation.history.push({
		role: 'user',
		content: userMessage,
		timestamp: new Date(),
	})

	// Генерация ответа с помощью Gemini
	await generateAndSendResponse(message, conversation)
}

// Отправка приветственного сообщения
async function sendGreeting(message) {
	const greeting = `Здравствуйте!❤️
Вас приветствует салон красоты ${CONFIG.SALON_NAME} ✨
Очень рада вашему обращению!🫶

Напишите, пожалуйста:
• На какую услугу вы хотите записаться?
• К какому мастеру?
• Когда вам будет удобно прийти?

Я с радостью помогу вам с записью ✨
Спасибо, что выбираете ${CONFIG.SALON_NAME} 🤍`

	await message.reply(greeting)
}

// Генерация ответа с Gemini AI
async function generateAndSendResponse(message, conversation) {
	try {
		const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

		// Формирование контекста для AI
		const systemPrompt = createSystemPrompt()
		const chatHistory = conversation.history.slice(-10).map(msg => ({
			role: msg.role === 'user' ? 'user' : 'model',
			parts: [{ text: msg.content }],
		}))

		const chat = model.startChat({
			history: [
				{ role: 'user', parts: [{ text: systemPrompt }] },
				{
					role: 'model',
					parts: [
						{
							text: 'Понял! Я буду работать как администратор салона красоты La Mirage. Готов помогать клиентам с записью.',
						},
					],
				},
				...chatHistory,
			],
		})

		const result = await chat.sendMessage(message.body)
		const response = result.response.text()

		// Сохранение ответа бота в историю
		conversation.history.push({
			role: 'assistant',
			content: response,
			timestamp: new Date(),
		})

		// Проверка, хочет ли клиент записаться
		const bookingIntent = await detectBookingIntent(conversation)

		if (bookingIntent.ready) {
			await initiateBookingConfirmation(
				message,
				conversation,
				bookingIntent.data
			)
		} else {
			await message.reply(response)
		}
	} catch (error) {
		console.error('Ошибка Gemini AI:', error)
		await message.reply(
			'Извините, произошла техническая ошибка. Попробуйте еще раз или позвоните нам.'
		)
	}
}

// Создание системного промпта для Gemini
function createSystemPrompt() {
	const mastersText = SALON_DATA.masters
		.map(m => `${m.name} - ${m.specialty}`)
		.join('\n')
	const servicesText =
		SALON_DATA.services.length > 0
			? SALON_DATA.services
					.map(s => `${s.name} - ${s.price} тг (${s.duration} мин)`)
					.join('\n')
			: 'Прайс-лист можно посмотреть в Instagram: ' + CONFIG.INSTAGRAM_LINK

	return `Ты - виртуальный администратор салона красоты "${CONFIG.SALON_NAME}". 

ТВОЯ РОЛЬ:
- Дружелюбный и профессиональный помощник
- Помогаешь клиентам записаться на услуги
- Отвечаешь на вопросы о салоне, услугах, мастерах
- Используй эмодзи умеренно (как в примере приветствия)
- Пиши естественно, как живой человек

ИНФОРМАЦИЯ О САЛОНЕ:
Режим работы: ${SALON_DATA.workingHours}
Адрес: ${SALON_DATA.address}
Instagram: ${CONFIG.INSTAGRAM_LINK}

НАШИ МАСТЕРА:
${mastersText}

УСЛУГИ И ЦЕНЫ:
${servicesText}

МАТЕРИАЛЫ:
Ногтевой сервис: ${SALON_DATA.materialInfo.nails}
Ресницы: ${SALON_DATA.materialInfo.lashes}

ВАЖНЫЕ ПРАВИЛА:
1. Если клиент спрашивает про цены, но их нет в базе - направляй в Instagram
2. Узнавай у клиента: услугу, мастера и желаемое время
3. Когда все данные собраны, скажи что отправляешь запрос администратору
4. Будь вежливым и милым, используй эмодзи в меру
5. Если клиент спрашивает про материалы - дай подробную информацию
6. Не придумывай цены или информацию, которой нет в базе

Отвечай естественно и помогай клиентам!`
}

// Определение намерения записаться
async function detectBookingIntent(conversation) {
	const recentMessages = conversation.history
		.slice(-6)
		.map(m => m.content)
		.join('\n')

	try {
		const model = genAI.getGenerativeModel({ model: 'gemini-pro' })
		const prompt = `Проанализируй диалог и определи, хочет ли клиент окончательно записаться на услугу.
    
Диалог:
${recentMessages}

Мастера салона: ${SALON_DATA.masters.map(m => m.name).join(', ')}

Ответь ТОЛЬКО в формате JSON:
{
  "ready": true/false,
  "service": "название услуги или null",
  "master": "имя мастера или null",
  "date": "дата в формате YYYY-MM-DD или null",
  "time": "время в формате HH:MM или null",
  "clientName": "имя клиента если упомянуто или null",
  "clientPhone": "телефон если упомянут или null"
}

Поставь ready: true только если клиент явно подтверждает желание записаться и указал основные данные (услугу, мастера, примерную дату/время).`

		const result = await model.generateContent(prompt)
		const response = result.response.text()

		// Извлечение JSON из ответа
		const jsonMatch = response.match(/\{[\s\S]*\}/)
		if (jsonMatch) {
			const data = JSON.parse(jsonMatch[0])
			return data
		}
	} catch (error) {
		console.error('Ошибка определения намерения:', error)
	}

	return { ready: false }
}

// Инициация подтверждения записи
async function initiateBookingConfirmation(message, conversation, bookingData) {
	const bookingId = `booking_${Date.now()}`

	// Сохранение данных о записи
	const booking = {
		id: bookingId,
		userId: message.from,
		...bookingData,
		status: 'pending',
		createdAt: new Date(),
	}

	database.bookings.push(booking)
	conversation.bookingData = booking

	// Отправка клиенту
	await message.reply(
		`Отлично! Я отправила ваш запрос администратору на подтверждение ✨\n\nДетали записи:\n📋 Услуга: ${
			bookingData.service || 'уточняется'
		}\n👤 Мастер: ${bookingData.master || 'уточняется'}\n📅 Дата: ${
			bookingData.date || 'уточняется'
		}\n🕐 Время: ${
			bookingData.time || 'уточняется'
		}\n\nВ ближайшее время с вами свяжется администратор для подтверждения! 🤍`
	)

	// Отправка администраторам
	await notifyAdmins(booking, message)
}

// Уведомление администраторов
async function notifyAdmins(booking, originalMessage) {
	const contact = await originalMessage.getContact()
	const clientName = contact.pushname || booking.clientName || 'Клиент'

	const adminMessage = `🔔 НОВАЯ ЗАПИСЬ

👤 Клиент: ${clientName}
📱 Телефон: ${booking.userId.replace('@c.us', '')}

📋 Услуга: ${booking.service || '❓'}
👨‍💼 Мастер: ${booking.master || '❓'}
📅 Дата: ${booking.date || '❓'}
🕐 Время: ${booking.time || '❓'}

Для подтверждения: /confirm_${booking.id}
Для отклонения: /reject_${booking.id}`

	for (const adminId of CONFIG.ADMIN_WHITELIST) {
		try {
			await whatsappClient.sendMessage(adminId, adminMessage)
		} catch (error) {
			console.error(`Ошибка отправки админу ${adminId}:`, error)
		}
	}
}

// Обработка ответа администратора
async function handleAdminResponse(message, command) {
	const [action, bookingId] = command.split('_')
	const booking = database.bookings.find(b => b.id === bookingId)

	if (!booking) {
		await message.reply('❌ Запись не найдена')
		return
	}

	if (action === '/confirm') {
		booking.status = 'confirmed'

		// Добавление в Google Calendar
		await addToCalendar(booking)

		// Уведомление клиента
		await whatsappClient.sendMessage(
			booking.userId,
			`✅ Ваша запись подтверждена!\n\n📋 ${booking.service}\n👤 Мастер: ${booking.master}\n📅 ${booking.date}\n🕐 ${booking.time}\n\nЖдем вас в ${CONFIG.SALON_NAME}! ✨`
		)

		// Обновление статистики
		updateStatistics(booking)

		await message.reply('✅ Запись подтверждена и добавлена в календарь')
	} else if (action === '/reject') {
		booking.status = 'rejected'

		await whatsappClient.sendMessage(
			booking.userId,
			`К сожалению, не можем подтвердить запись на указанное время 😔\n\nПожалуйста, выберите другое удобное время, и я помогу с записью! 🤍`
		)

		await message.reply('❌ Запись отклонена, клиент уведомлен')
	}
}

// Добавление записи в Google Calendar
async function addToCalendar(booking) {
	if (!calendar) {
		console.log('⚠️ Google Calendar не настроен')
		return
	}

	try {
		const startDate = new Date(`${booking.date}T${booking.time}:00`)
		const endDate = new Date(startDate.getTime() + 90 * 60000) // +90 минут

		const event = {
			summary: `${booking.service} - ${booking.master}`,
			description: `Клиент: ${booking.clientName || booking.userId}\nТелефон: ${
				booking.clientPhone || booking.userId.replace('@c.us', '')
			}`,
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
					{ method: 'popup', minutes: 1440 }, // За день
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
function updateStatistics(booking) {
	const masterName = booking.master
	if (!masterName) return

	const stats = database.statistics.get(masterName) || {
		totalBookings: 0,
		confirmedBookings: 0,
		revenue: 0,
	}

	stats.totalBookings++
	if (booking.status === 'confirmed') {
		stats.confirmedBookings++

		// Поиск цены услуги
		const service = SALON_DATA.services.find(s =>
			s.name.toLowerCase().includes(booking.service?.toLowerCase())
		)
		if (service) {
			stats.revenue += service.price
		}
	}

	database.statistics.set(masterName, stats)
}

// Отправка статистики администратору
async function sendAdminStats(message) {
	let statsText = `📊 СТАТИСТИКА САЛОНА\n\n`

	// Статистика по мастерам
	SALON_DATA.masters.forEach(master => {
		const stats = database.statistics.get(master.name) || {
			totalBookings: 0,
			confirmedBookings: 0,
			revenue: 0,
		}

		statsText += `👤 ${master.name} (${master.specialty})\n`
		statsText += `   📝 Всего записей: ${stats.totalBookings}\n`
		statsText += `   ✅ Подтверждено: ${stats.confirmedBookings}\n`
		statsText += `   💰 Доход: ${stats.revenue.toLocaleString()} тг\n\n`
	})

	// Общая статистика
	let totalRevenue = 0
	let totalBookings = 0
	database.statistics.forEach(stats => {
		totalRevenue += stats.revenue
		totalBookings += stats.totalBookings
	})

	statsText += `📈 ОБЩАЯ СТАТИСТИКА\n`
	statsText += `Всего записей: ${totalBookings}\n`
	statsText += `Общий доход: ${totalRevenue.toLocaleString()} тг\n`
	statsText += `Активных диалогов: ${database.conversations.size}`

	await message.reply(statsText)
}

// ===================== ЭКСПОРТ ДЛЯ ТЕСТОВ =====================
module.exports = {
	CONFIG,
	SALON_DATA,
	database,
	initGemini,
	initGoogleCalendar,
	initWhatsApp,
	createSystemPrompt,
	updateStatistics,
	// Экспортируем для тестирования
	sendGreeting,
	detectBookingIntent,
	addToCalendar,
}

// ===================== ЗАПУСК БОТА =====================
async function startBot() {
	console.log('🚀 Запуск бота La Mirage...')

	validateConfig()
	initGemini()
	await initGoogleCalendar()
	initWhatsApp()
}

// Запуск только если это не тестовая среда
if (CONFIG.NODE_ENV !== 'test' && require.main === module) {
	startBot().catch(console.error)
}

// Обработка завершения
process.on('SIGINT', async () => {
	console.log('\n👋 Остановка бота...')
	if (whatsappClient) {
		await whatsappClient.destroy()
	}
	process.exit(0)
})
