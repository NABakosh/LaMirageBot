// Симулятор WhatsApp для тестирования бота без реального WhatsApp API
// Запуск: node test-simulator.js

require('dotenv').config()
const readline = require('readline')

// ===================== MOCK ДАННЫЕ =====================
const MOCK_USERS = {
	client1: {
		id: '77001234567@c.us',
		name: 'Анна Иванова',
		pushname: 'Анна',
	},
	client2: {
		id: '77009876543@c.us',
		name: 'Мария Петрова',
		pushname: 'Мария',
	},
	admin: {
		id: '77001111111@c.us',
		name: 'Администратор',
		pushname: 'Админ',
	},
}

// ===================== MOCK WhatsApp Client =====================
class MockWhatsAppClient {
	constructor() {
		this.handlers = {}
		this.messages = []
		this.currentUser = null
	}

	on(event, handler) {
		this.handlers[event] = handler
	}

	async initialize() {
		console.log('🔄 Инициализация мок-клиента WhatsApp...')
		setTimeout(() => {
			console.log('✅ Мок-клиент готов!\n')
			if (this.handlers.ready) {
				this.handlers.ready()
			}
		}, 1000)
	}

	async sendMessage(to, content) {
		this.messages.push({
			to,
			content,
			timestamp: new Date(),
		})
		console.log(`\n📤 Отправлено ${to}:`)
		console.log(`   ${content}\n`)
	}

	async destroy() {
		console.log('👋 Мок-клиент остановлен')
	}

	// Симуляция входящего сообщения
	async simulateMessage(userId, body) {
		const user = Object.values(MOCK_USERS).find(u => u.id === userId)

		const mockMessage = {
			from: userId,
			body: body,
			fromMe: false,
			timestamp: Date.now(),

			async reply(content) {
				console.log(`\n💬 Бот ответил:`)
				console.log(`   ${content}\n`)
			},

			async getContact() {
				return {
					pushname: user?.pushname || 'Клиент',
					name: user?.name || 'Неизвестный',
				}
			},
		}

		if (this.handlers.message) {
			await this.handlers.message(mockMessage)
		}
	}
}

// ===================== MOCK Gemini AI =====================
class MockGeminiAI {
	constructor() {
		this.responses = {
			greeting:
				'Здравствуйте! Я виртуальный администратор салона La Mirage. Чем могу помочь?',
			service_question:
				'Отлично! На какую услугу вы хотели бы записаться? У нас есть маникюр, педикюр, наращивание ресниц.',
			master_question:
				'Прекрасный выбор! К какому мастеру вы хотите записаться? У нас работают: Юна, Аружан, Айлин, Айгерим, Гульназ, Жазира (маникюр) и Лена (ресницы).',
			time_question:
				'Замечательно! Когда вам будет удобно прийти? Мы работаем ежедневно с 10:00 до 21:00.',
			price_question:
				'Цены на наши услуги можно посмотреть в нашем Instagram. Какая услуга вас интересует?',
			materials:
				'Мы работаем только на профессиональных материалах премиум-класса: гель-лаки CND, Kodi, базы Rubber Base. Все материалы гипоаллергенны и безопасны! ✨',
			booking_confirm:
				'Отлично! Я отправила ваш запрос администратору на подтверждение ✨ В ближайшее время с вами свяжутся!',
		}
	}

	getGenerativeModel() {
		return {
			startChat: config => ({
				sendMessage: async message => {
					const text = message.toLowerCase()

					let response = 'Спасибо за ваше сообщение! Чем могу помочь?'

					if (text.includes('привет') || text.includes('здравствуй')) {
						response = this.responses.greeting
					} else if (
						text.includes('цен') ||
						text.includes('стоимость') ||
						text.includes('прайс')
					) {
						response = this.responses.price_question
					} else if (
						text.includes('материал') ||
						text.includes('чем наращива')
					) {
						response = this.responses.materials
					} else if (
						text.includes('маникюр') ||
						text.includes('педикюр') ||
						text.includes('ресниц')
					) {
						response = this.responses.master_question
					} else if (
						text.includes('юна') ||
						text.includes('лена') ||
						text.includes('мастер')
					) {
						response = this.responses.time_question
					} else if (
						text.match(/\d{1,2}:\d{2}/) ||
						text.includes('завтра') ||
						text.includes('сегодня')
					) {
						response = this.responses.booking_confirm
					}

					return {
						response: {
							text: () => response,
						},
					}
				},
			}),

			generateContent: async prompt => {
				// Простая логика для определения намерения записаться
				const hasService =
					prompt.toLowerCase().includes('маникюр') ||
					prompt.toLowerCase().includes('ресниц')
				const hasMaster =
					prompt.toLowerCase().includes('юна') ||
					prompt.toLowerCase().includes('лена')
				const hasTime =
					/\d{1,2}:\d{2}/.test(prompt) ||
					prompt.includes('завтра') ||
					prompt.includes('сегодня')

				const ready = hasService && hasMaster && hasTime

				const data = {
					ready: ready,
					service: hasService ? 'Маникюр с покрытием' : null,
					master: hasMaster ? (prompt.includes('юна') ? 'Юна' : 'Лена') : null,
					date: hasTime ? '2024-12-20' : null,
					time: hasTime ? '14:00' : null,
					clientName: null,
					clientPhone: null,
				}

				return {
					response: {
						text: () => JSON.stringify(data),
					},
				}
			},
		}
	}
}

// ===================== ИНТЕРАКТИВНЫЙ ТЕСТЕР =====================
class InteractiveTester {
	constructor() {
		this.rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		})
		this.currentUserId = MOCK_USERS.client1.id
		this.isAdmin = false
	}

	async start() {
		console.log('╔════════════════════════════════════════════════════════╗')
		console.log('║   🧪 СИМУЛЯТОР WHATSAPP БОТА LA MIRAGE                ║')
		console.log('╚════════════════════════════════════════════════════════╝\n')

		this.showHelp()
		this.promptUser()
	}

	showHelp() {
		console.log('📋 Доступные команды:')
		console.log('  /user <client1|client2|admin> - переключить пользователя')
		console.log('  /stats - показать статистику (только для админов)')
		console.log('  /confirm_<id> - подтвердить запись (только для админов)')
		console.log('  /reject_<id> - отклонить запись (только для админов)')
		console.log('  /help - показать эту справку')
		console.log('  /clear - очистить экран')
		console.log('  /exit - выход\n')

		console.log('💡 Примеры диалогов:')
		console.log('  "Привет, хочу записаться на маникюр"')
		console.log('  "Сколько стоит маникюр?"')
		console.log('  "На чем вы наращиваете ресницы?"')
		console.log('  "Запишите меня к Юне на завтра в 14:00"\n')
	}

	promptUser() {
		const user = Object.values(MOCK_USERS).find(
			u => u.id === this.currentUserId
		)
		const prompt = this.isAdmin ? '👑 ADMIN> ' : `💬 ${user.pushname}> `

		this.rl.question(prompt, async input => {
			await this.handleInput(input.trim())
			this.promptUser()
		})
	}

	async handleInput(input) {
		if (!input) return

		// Команды
		if (input.startsWith('/')) {
			await this.handleCommand(input)
			return
		}

		// Обычное сообщение
		console.log(`\n📨 Отправка сообщения от ${this.currentUserId}...`)

		// Симуляция ответа бота
		await this.simulateBot(input)
	}

	async handleCommand(command) {
		const parts = command.split(' ')
		const cmd = parts[0].toLowerCase()
		const arg = parts[1]

		switch (cmd) {
			case '/user':
				if (MOCK_USERS[arg]) {
					this.currentUserId = MOCK_USERS[arg].id
					this.isAdmin = arg === 'admin'
					console.log(
						`\n✅ Переключено на пользователя: ${MOCK_USERS[arg].pushname}`
					)
					if (this.isAdmin) {
						console.log('👑 Вы теперь администратор!\n')
					}
				} else {
					console.log(
						`\n❌ Пользователь не найден. Доступные: client1, client2, admin\n`
					)
				}
				break

			case '/stats':
			case '/admin':
				if (this.isAdmin) {
					this.showMockStats()
				} else {
					console.log('\n❌ Эта команда доступна только администраторам\n')
				}
				break

			case '/confirm':
			case '/reject':
				if (this.isAdmin) {
					const action = cmd === '/confirm' ? 'подтверждена' : 'отклонена'
					console.log(`\n✅ Запись ${action}. Клиент получит уведомление.\n`)
				} else {
					console.log('\n❌ Эта команда доступна только администраторам\n')
				}
				break

			case '/help':
				console.log('\n')
				this.showHelp()
				break

			case '/clear':
				console.clear()
				console.log('🧪 СИМУЛЯТОР WHATSAPP БОТА LA MIRAGE\n')
				break

			case '/exit':
				console.log('\n👋 До свидания!')
				process.exit(0)
				break

			default:
				console.log(`\n❌ Неизвестная команда: ${cmd}\n`)
		}
	}

	async simulateBot(userMessage) {
		const mockAI = new MockGeminiAI()
		const model = mockAI.getGenerativeModel()
		const chat = model.startChat({})

		const result = await chat.sendMessage(userMessage)
		const response = result.response.text()

		console.log(`\n💬 Бот ответил:`)
		console.log(`   ${response}\n`)

		// Проверка намерения записаться
		const intentResult = await model.generateContent(userMessage)
		const intentData = JSON.parse(intentResult.response.text())

		if (intentData.ready) {
			console.log('📋 Детектировано намерение записаться!')
			console.log(`   Услуга: ${intentData.service}`)
			console.log(`   Мастер: ${intentData.master}`)
			console.log(`   Дата: ${intentData.date}`)
			console.log(`   Время: ${intentData.time}`)
			console.log('\n🔔 Администраторы получат уведомление:\n')

			const bookingId = `booking_${Date.now()}`
			console.log(`🔔 НОВАЯ ЗАПИСЬ`)
			console.log(`👤 Клиент: Тестовый клиент`)
			console.log(`📱 Телефон: ${this.currentUserId.replace('@c.us', '')}`)
			console.log(`📋 Услуга: ${intentData.service}`)
			console.log(`👨‍💼 Мастер: ${intentData.master}`)
			console.log(`📅 Дата: ${intentData.date}`)
			console.log(`🕐 Время: ${intentData.time}`)
			console.log(`\nДля подтверждения: /confirm_${bookingId}`)
			console.log(`Для отклонения: /reject_${bookingId}\n`)
		}
	}

	showMockStats() {
		console.log('\n📊 СТАТИСТИКА САЛОНА\n')
		console.log('👤 Юна (мастер по маникюру)')
		console.log('   📝 Всего записей: 15')
		console.log('   ✅ Подтверждено: 12')
		console.log('   💰 Доход: 84,000 тг\n')

		console.log('👤 Лена (мастер по ресницам)')
		console.log('   📝 Всего записей: 8')
		console.log('   ✅ Подтверждено: 7')
		console.log('   💰 Доход: 84,000 тг\n')

		console.log('👤 Аружан (мастер по маникюру)')
		console.log('   📝 Всего записей: 10')
		console.log('   ✅ Подтверждено: 9')
		console.log('   💰 Доход: 63,000 тг\n')

		console.log('📈 ОБЩАЯ СТАТИСТИКА')
		console.log('Всего записей: 33')
		console.log('Общий доход: 231,000 тг')
		console.log('Активных диалогов: 5\n')
	}
}

// ===================== АВТОМАТИЧЕСКИЕ ТЕСТЫ =====================
async function runAutomatedTests() {
	console.log('╔════════════════════════════════════════════════════════╗')
	console.log('║   🤖 АВТОМАТИЧЕСКИЕ ТЕСТЫ БОТА                        ║')
	console.log('╚════════════════════════════════════════════════════════╝\n')

	const mockAI = new MockGeminiAI()
	const tests = [
		{
			name: 'Приветствие',
			message: 'Привет!',
			expected: 'виртуальный администратор',
		},
		{
			name: 'Вопрос о ценах',
			message: 'Сколько стоит маникюр?',
			expected: 'Instagram',
		},
		{
			name: 'Вопрос о материалах',
			message: 'На чем вы наращиваете?',
			expected: 'CND',
		},
		{
			name: 'Запись на услугу',
			message: 'Хочу записаться на маникюр',
			expected: 'мастеру',
		},
	]

	let passed = 0
	let failed = 0

	for (const test of tests) {
		const model = mockAI.getGenerativeModel()
		const chat = model.startChat({})
		const result = await chat.sendMessage(test.message)
		const response = result.response.text()

		const success = response.toLowerCase().includes(test.expected.toLowerCase())

		if (success) {
			console.log(`✅ ${test.name}: PASSED`)
			console.log(`   Сообщение: "${test.message}"`)
			console.log(`   Ответ: "${response.substring(0, 60)}..."\n`)
			passed++
		} else {
			console.log(`❌ ${test.name}: FAILED`)
			console.log(`   Ожидалось слово: "${test.expected}"`)
			console.log(`   Получено: "${response}"\n`)
			failed++
		}
	}

	console.log('═══════════════════════════════════════════════════════')
	console.log(`📊 Результаты: ${passed} пройдено, ${failed} провалено`)
	console.log('═══════════════════════════════════════════════════════\n')
}

// ===================== ЗАПУСК =====================
async function main() {
	const args = process.argv.slice(2)

	if (args.includes('--auto') || args.includes('-a')) {
		await runAutomatedTests()
		process.exit(0)
	} else {
		const tester = new InteractiveTester()
		await tester.start()
	}
}

main()
