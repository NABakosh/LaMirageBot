// Простой in-memory rate limiter
// Защищает бота от перегрузки при flood атаках

class RateLimiter {
	constructor(maxRequests = 10, windowMs = 60000) { // По умолчанию 10 запросов в минуту
		this.maxRequests = maxRequests
		this.windowMs = windowMs
		this.requests = new Map() // userId -> [timestamps]
	}

	/**
	 * Проверяет можно ли обработать запрос от пользователя
	 * @param {string} userId - ID пользователя
	 * @returns {Object} { allowed: boolean, retryAfter: number|null }
	 */
	checkLimit(userId) {
		const now = Date.now()
		const userRequests = this.requests.get(userId) || []

		// Удаляем старые запросы (вне окна)
		const validRequests = userRequests.filter(
			timestamp => now - timestamp < this.windowMs
		)

		// Проверяем лимит
		if (validRequests.length >= this.maxRequests) {
			const oldestRequest = validRequests[0]
			const retryAfter = Math.ceil((oldestRequest + this.windowMs - now) / 1000)

			return {
				allowed: false,
				retryAfter,
				remaining: 0
			}
		}

		// Добавляем текущий запрос
		validRequests.push(now)
		this.requests.set(userId, validRequests)

		return {
			allowed: true,
			retryAfter: null,
			remaining: this.maxRequests - validRequests.length
		}
	}

	/**
	 * Сброс лимита для пользователя (например при сбросе сессии)
	 * @param {string} userId
	 */
	reset(userId) {
		this.requests.delete(userId)
	}

	/**
	 * Очистка всех лимитов
	 */
	clearAll() {
		this.requests.clear()
	}

	/**
	 * Получить статистику
	 */
	getStats() {
		return {
			totalUsers: this.requests.size,
			maxRequests: this.maxRequests,
			windowMs: this.windowMs
		}
	}

	/**
	 * Периодическая очистка старых записей
	 * Запускать через setInterval каждые 5 минут
	 */
	cleanup() {
		const now = Date.now()
		const toDelete = []

		for (const [userId, timestamps] of this.requests.entries()) {
			const validTimestamps = timestamps.filter(
				t => now - t < this.windowMs
			)

			if (validTimestamps.length === 0) {
				toDelete.push(userId)
			} else {
				this.requests.set(userId, validTimestamps)
			}
		}

		toDelete.forEach(userId => this.requests.delete(userId))

		if (toDelete.length > 0) {
			console.log(`🧹 Rate limiter cleanup: удалено ${toDelete.length} неактивных пользователей`)
		}
	}
}

module.exports = RateLimiter
