const TelegramBot = require('node-telegram-bot-api')

let bot = null
let startBotFn = null
let stopBotFn = null
let getStateFn = null
let adminChatId = null

function initTelegramBot(startFn, stopFn, getStateFunction, token, chatId) {
	if (!token || !chatId) {
		console.warn('⚠️  Telegram bot not configured. Set TELEGRAM_ALERT_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID in .env')
		return
	}

	startBotFn = startFn
	stopBotFn = stopFn
	getStateFn = getStateFunction
	adminChatId = chatId.toString()

	try {
		bot = new TelegramBot(token, { polling: true })
		console.log('✅ Telegram bot initialized')

		// Authentication middleware
		const requireAdmin = (msg, handler) => {
			if (msg.chat.id.toString() !== adminChatId) {
				bot.sendMessage(msg.chat.id, '❌ Unauthorized. Only admin can control the bot.')
				console.log(`⚠️  Unauthorized Telegram command from chat ID: ${msg.chat.id}`)
				return false
			}
			return handler()
		}

		// /start command
		bot.onText(/\/start/, async (msg) => {
			requireAdmin(msg, async () => {
				try {
					const state = getStateFn()
					if (state.running) {
						bot.sendMessage(msg.chat.id, '⚠️  WhatsApp bot is already running')
						return
					}

					bot.sendMessage(msg.chat.id, '🔄 Starting WhatsApp bot...')
					await startBotFn()
					bot.sendMessage(msg.chat.id, '✅ WhatsApp bot started successfully')
				} catch (error) {
					bot.sendMessage(msg.chat.id, `❌ Failed to start bot: ${error.message}`)
					console.error('❌ Error starting bot via Telegram:', error)
				}
			})
		})

		// /stop command
		bot.onText(/\/stop/, async (msg) => {
			requireAdmin(msg, async () => {
				try {
					const state = getStateFn()
					if (!state.running) {
						bot.sendMessage(msg.chat.id, '⚠️  WhatsApp bot is already stopped')
						return
					}

					bot.sendMessage(msg.chat.id, '🛑 Stopping WhatsApp bot...')
					await stopBotFn()
					bot.sendMessage(msg.chat.id, '✅ WhatsApp bot stopped successfully')
				} catch (error) {
					bot.sendMessage(msg.chat.id, `❌ Failed to stop bot: ${error.message}`)
					console.error('❌ Error stopping bot via Telegram:', error)
				}
			})
		})

		// /status command
		bot.onText(/\/status/, (msg) => {
			requireAdmin(msg, () => {
				try {
					const state = getStateFn()
					const status = state.running ? '🟢 Running' : '🔴 Stopped'
					const uptime = state.running && state.startTime 
						? Math.floor((Date.now() - state.startTime) / 1000 / 60)
						: 0

					let statusMessage = `**WhatsApp Bot Status**\n\n`
					statusMessage += `Status: ${status}\n`
					
					if (state.running) {
						statusMessage += `Uptime: ${uptime} minutes\n`
						statusMessage += `Started: ${new Date(state.startTime).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}\n`
					} else if (state.stopTime) {
						statusMessage += `Stopped: ${new Date(state.stopTime).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}\n`
					}

					bot.sendMessage(msg.chat.id, statusMessage, { parse_mode: 'Markdown' })
				} catch (error) {
					bot.sendMessage(msg.chat.id, `❌ Error getting status: ${error.message}`)
					console.error('❌ Error getting status via Telegram:', error)
				}
			})
		})

		// /help command
		bot.onText(/\/help/, (msg) => {
			requireAdmin(msg, () => {
				const helpMessage = `**La Mirage Bot Control**\n\n` +
					`Available commands:\n` +
					`/start - Start WhatsApp bot\n` +
					`/stop - Stop WhatsApp bot\n` +
					`/status - Check bot status\n` +
					`/help - Show this help\n\n` +
					`Admin: ${adminChatId}`
				bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' })
			})
		})

		// Error handling
		bot.on('polling_error', (error) => {
			console.error('❌ Telegram polling error:', error.message)
		})

	} catch (error) {
		console.error('❌ Failed to initialize Telegram bot:', error.message)
	}
}

module.exports = { initTelegramBot }
