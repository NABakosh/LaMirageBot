// Простой in-memory LRU кэш для частых ответов
// Снижает нагрузку на Gemini API

class SimpleCache {
	constructor(maxSize = 100, ttlMs = 3600000) { // TTL по умолчанию 1 час
		this.cache = new Map()
		this.maxSize = maxSize
		this.ttlMs = ttlMs
	}

	// Генерация ключа из текста (нормализация)
	_normalizeKey(text) {
		return text
			.toLowerCase()
			.trim()
			.replace(/\s+/g, ' ')
			.replace(/[?!.,]/g, '')
	}

	// Получить из кэша
	get(key) {
		const normalizedKey = this._normalizeKey(key)
		const item = this.cache.get(normalizedKey)

		if (!item) {
			return null
		}

		// Проверка TTL
		if (Date.now() - item.timestamp > this.ttlMs) {
			this.cache.delete(normalizedKey)
			return null
		}

		// LRU: перемещаем в конец (самый свежий)
		this.cache.delete(normalizedKey)
		this.cache.set(normalizedKey, item)

		return item.value
	}

	// Сохранить в кэш
	set(key, value) {
		const normalizedKey = this._normalizeKey(key)

		// Если достигли лимита - удаляем самый старый (первый)
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value
			this.cache.delete(firstKey)
		}

		this.cache.set(normalizedKey, {
			value,
			timestamp: Date.now(),
		})
	}

	// Очистить весь кэш
	clear() {
		this.cache.clear()
	}

	// Получить статистику
	getStats() {
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			ttlMs: this.ttlMs,
		}
	}
}

// Кэш для быстрых ответов на частые вопросы
const QUICK_RESPONSES = {
	// Вопросы о ценах
	patterns: [
		{
			keywords: ['цена', 'цены', 'сколько стоит', 'стоимость', 'прайс'],
			response: `💰 Наши цены:\n\n` +
				`МАНИКЮР:\n` +
				`Мастер Юна (главный мастер):\n` +
				`• Маникюр без покрытия - 3000 тг\n` +
				`• Маникюр с укреплением - 7000 тг\n` +
				`• Наращивание ногтей типсами - 9000 тг\n` +
				`• Наращивание верхними формами - 10000 тг\n\n` +
				`Другие мастера (Аружан, Айгерим, Гульназ, Жазира):\n` +
				`• Маникюр без покрытия - 1000 тг\n` +
				`• Маникюр с укреплением - 3500 тг\n` +
				`• Наращивание ногтей - 5000 тг\n\n` +
				`Вы можете выбрать услугу и мастера, и я помогу записаться! ✨`
		},
		{
			keywords: ['адрес', 'где находится', 'как добраться', 'где вы', 'где салон'],
			response: null // Будет заполнено динамически из CONFIG
		},
		{
			keywords: ['режим работы', 'когда работаете', 'часы работы', 'время работы', 'график'],
			response: null // Будет заполнено динамически из CONFIG
		},
		{
			keywords: ['контакт', 'телефон', 'позвонить', 'связаться'],
			response: `📞 Связаться с нами:\n\n` +
				`WhatsApp: Вы уже со мной общаетесь! 🤍\n` +
				`Instagram: Следите за нашими работами\n\n` +
				`Если хотите записаться - просто напишите когда вам удобно! ✨`
		}
	],

	// Проверка соответствия вопроса шаблону
	match(message) {
		const lowerMessage = message.toLowerCase()

		for (const pattern of this.patterns) {
			const hasKeyword = pattern.keywords.some(keyword =>
				lowerMessage.includes(keyword)
			)

			if (hasKeyword && pattern.response) {
				return pattern.response
			}
		}

		return null
	}
}

// Экспорт
module.exports = {
	SimpleCache,
	QUICK_RESPONSES
}
