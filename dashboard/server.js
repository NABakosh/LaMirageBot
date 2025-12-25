require('dotenv').config()
const express = require('express')
const { Pool } = require('pg')
const path = require('path')

const app = express()
const PORT = process.env.DASHBOARD_PORT || 3000

const pool = new Pool({
	connectionString:
		process.env.DATABASE_URL || 'postgresql://localhost:5432/lamiragebeauty',
})

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')))

// ===================== API ENDPOINTS =====================

// Общая статистика
app.get('/api/overview', async (req, res) => {
	try {
		const totalBookings = await pool.query('SELECT COUNT(*) FROM bookings')
		const confirmedBookings = await pool.query(
			"SELECT COUNT(*) FROM bookings WHERE status = 'confirmed'"
		)
		const totalClients = await pool.query('SELECT COUNT(*) FROM clients')
		const totalRevenue = await pool.query('SELECT SUM(revenue) FROM statistics')

		res.json({
			totalBookings: parseInt(totalBookings.rows[0].count),
			confirmedBookings: parseInt(confirmedBookings.rows[0].count),
			totalClients: parseInt(totalClients.rows[0].count),
			totalRevenue: parseInt(totalRevenue.rows[0].sum || 0),
		})
	} catch (error) {
		console.error('Ошибка получения общей статистики:', error)
		res.status(500).json({ error: 'Ошибка сервера' })
	}
})

// Статистика по мастерам
app.get('/api/masters', async (req, res) => {
	try {
		const result = await pool.query(
			'SELECT * FROM statistics ORDER BY revenue DESC'
		)
		res.json(result.rows)
	} catch (error) {
		console.error('Ошибка получения мастеров:', error)
		res.status(500).json({ error: 'Ошибка сервера' })
	}
})

// Все записи
app.get('/api/bookings', async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT b.*, c.name as client_full_name, c.total_visits
			FROM bookings b
			LEFT JOIN clients c ON b.client_phone = c.phone
			ORDER BY b.created_at DESC
			LIMIT 100
		`)
		res.json(result.rows)
	} catch (error) {
		console.error('Ошибка получения записей:', error)
		res.status(500).json({ error: 'Ошибка сервера' })
	}
})

// Клиенты
app.get('/api/clients', async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT c.*, 
				COUNT(b.id) as booking_count,
				MAX(b.confirmed_at) as last_booking
			FROM clients c
			LEFT JOIN bookings b ON c.phone = b.client_phone
			GROUP BY c.phone, c.name, c.user_id, c.total_visits, c.total_spent, c.last_visit, c.created_at
			ORDER BY c.created_at DESC
		`)
		res.json(result.rows)
	} catch (error) {
		console.error('Ошибка получения клиентов:', error)
		res.status(500).json({ error: 'Ошибка сервера' })
	}
})

// Статистика по услугам
app.get('/api/services-stats', async (req, res) => {
	try {
		const result = await pool.query(`
			SELECT service, 
				COUNT(*) as count, 
				COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count,
				SUM(price) as total_revenue
			FROM bookings
			WHERE service IS NOT NULL
			GROUP BY service
			ORDER BY count DESC
		`)
		res.json(result.rows)
	} catch (error) {
		console.error('Ошибка получения статистики услуг:', error)
		res.status(500).json({ error: 'Ошибка сервера' })
	}
})

// Главная страница
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
	console.log(`\n📊 Dashboard запущен: http://localhost:${PORT}`)
	console.log('✨ Откройте в браузере для просмотра статистики\n')
})
