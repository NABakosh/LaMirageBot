// Retry helper с exponential backoff для Gemini API
// Снижает количество ошибок при временных сбоях API

/**
 * Выполняет функцию с retry логикой
 * @param {Function} fn - Функция для выполнения
 * @param {Object} options - Опции retry
 * @param {number} options.maxRetries - Максимальное количество попыток (по умолчанию 3)
 * @param {number} options.initialDelay - Начальная задержка в мс (по умолчанию 1000)
 * @param {number} options.maxDelay - Максимальная задержка в мс (по умолчанию 10000)
 * @param {Function} options.shouldRetry - Функция проверки нужно ли retry
 * @returns {Promise<any>}
 */
async function retryWithBackoff(fn, options = {}) {
	const {
		maxRetries = 3,
		initialDelay = 1000,
		maxDelay = 10000,
		shouldRetry = isRetriableError
	} = options

	let lastError
	let delay = initialDelay

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn()
		} catch (error) {
			lastError = error

			// Проверяем нужно ли делать retry
			if (!shouldRetry(error) || attempt === maxRetries) {
				throw error
			}

			// Логируем попытку
			console.log(`⚠️  Попытка ${attempt}/${maxRetries} не удалась: ${error.message}`)
			console.log(`   Повтор через ${delay}ms...`)

			// Ждем перед следующей попыткой
			await sleep(delay)

			// Exponential backoff с jitter
			delay = Math.min(delay * 2 + Math.random() * 1000, maxDelay)
		}
	}

	throw lastError
}

/**
 * Проверяет является ли ошибка временной (retriable)
 * @param {Error} error
 * @returns {boolean}
 */
function isRetriableError(error) {
	const errorMessage = error.message?.toLowerCase() || ''
	const errorString = error.toString().toLowerCase()

	// Network errors
	if (
		errorMessage.includes('network') ||
		errorMessage.includes('timeout') ||
		errorMessage.includes('econnreset') ||
		errorMessage.includes('econnrefused') ||
		errorString.includes('fetch failed')
	) {
		return true
	}

	// Rate limiting
	if (
		errorMessage.includes('429') ||
		errorMessage.includes('rate limit') ||
		errorMessage.includes('quota')
	) {
		return true
	}

	// Server errors (5xx)
	if (
		errorMessage.includes('503') ||
		errorMessage.includes('502') ||
		errorMessage.includes('500') ||
		errorMessage.includes('internal server error')
	) {
		return true
	}

	// Vertex AI specific errors
	if (
		errorMessage.includes('deadline exceeded') ||
		errorMessage.includes('unavailable') ||
		errorMessage.includes('resource exhausted')
	) {
		return true
	}

	return false
}

/**
 * Простая функция задержки
 * @param {number} ms - Миллисекунды
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
	retryWithBackoff,
	isRetriableError,
	sleep
}
