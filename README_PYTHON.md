# 🤖 La Mirage Beauty Bot - Python Version

Полная Python версия WhatsApp бота для салона красоты La Mirage Beauty.

## 📋 Описание

Это полный перевод JavaScript бота на Python со всеми функциями:
- ✅ Интеграция с Vertex AI (Gemini) для умных ответов
- ✅ Управление записями через PostgreSQL
- ✅ Интеграция с Google Calendar
- ✅ Автоматические напоминания
- ✅ Проверка доступности времени
- ✅ Админ-панель через WhatsApp
- ✅ Режим оператора для прямого общения
- ✅ Управление сессиями (автоочистка через 30 минут)

## 🚀 Установка

### 1. Установка зависимостей

```bash
pip install -r requirements.txt
```

### 2. Настройка переменных окружения

Создайте файл `.env` в корне проекта:

```env
# Vertex AI (Google Cloud)
VERTEX_PROJECT_ID=lamirage
VERTEX_LOCATION=us-central1
VERTEX_KEY_FILE=./vertex_key.json

# Google Calendar
GOOGLE_CALENDAR_CREDENTIALS=./credentials.json
CALENDAR_ID=primary

# База данных PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/lamiragebeauty

# Администраторы (номера WhatsApp через запятую)
ADMIN_WHITELIST=77064240050,77051234567

# Информация о салоне
SALON_NAME=La Mirage Beauty
SALON_ADDRESS=ваш адрес
INSTAGRAM_LINK=https://instagram.com/lamirage
WORKING_HOURS=Ежедневно с 10:00 до 21:00

# Окружение
NODE_ENV=production
```

### 3. Настройка Google Cloud

#### Vertex AI:
1. Создайте проект в [Google Cloud Console](https://console.cloud.google.com/)
2. Включите Vertex AI API
3. Создайте Service Account с ролью "Vertex AI User"
4. Скачайте JSON ключ и сохраните как `vertex_key.json`

#### Google Calendar:
1. Включите Google Calendar API в том же проекте
2. Создайте Service Account с доступом к Calendar
3. Скачайте JSON ключ и сохраните как `credentials.json`
4. Дайте доступ к календарю для email из Service Account

### 4. Настройка PostgreSQL

```bash
# Создайте базу данных
createdb lamiragebeauty

# Или через psql
psql -U postgres
CREATE DATABASE lamiragebeauty;
```

База данных будет автоматически инициализирована при первом запуске.

### 5. Настройка WhatsApp

**ВАЖНО**: Для работы с WhatsApp в Python есть несколько вариантов:

#### Вариант 1: whatsapp-web.py (неофициальная библиотека)
```bash
pip install whatsapp-web.py
```

Требует дополнительной настройки и может быть нестабильной.

#### Вариант 2: Twilio API (рекомендуется для продакшена)
```bash
pip install twilio
```

Требует регистрации и платной подписки на [Twilio](https://www.twilio.com/whatsapp).

#### Вариант 3: WhatsApp Business API
Официальный API, требует регистрации бизнеса и одобрения от Meta.

## 📦 Структура проекта

```
La Mirage/
├── main.py                 # Основной файл бота (Python версия)
├── main.js                 # Оригинальная JavaScript версия
├── requirements.txt        # Python зависимости
├── .env                    # Переменные окружения
├── vertex_key.json        # Ключ Vertex AI (не коммитить!)
├── credentials.json       # Ключ Google Calendar (не коммитить!)
└── README_PYTHON.md       # Эта документация
```

## 🎯 Основные функции

### Управление разговорами
```python
from main import ConversationManager

# Получить разговор
conversation = await ConversationManager.get_conversation(user_id)

# Сохранить разговор
await ConversationManager.save_conversation(conversation)

# Сбросить сессию
await ConversationManager.reset_session(user_id)
```

### Проверка доступности
```python
from main import AvailabilityChecker

# Проверить свободно ли время
is_free = await AvailabilityChecker.check_availability(
    master_name="Юна",
    date="2024-01-30",
    time="14:00",
    duration_minutes=90
)

# Получить свободные слоты
slots = await AvailabilityChecker.get_available_slots("Юна", "2024-01-30")
```

### Валидация данных
```python
from main import DataValidator

# Валидация имени
name_result = await DataValidator.validate_name("Азат")

# Валидация телефона
phone_result = await DataValidator.validate_phone("+7 706 424 0050")
```

## 🔧 Запуск

### Разработка
```bash
python main.py
```

### Продакшн (с systemd)

Создайте файл `/etc/systemd/system/lamirage-bot.service`:

```ini
[Unit]
Description=La Mirage Beauty WhatsApp Bot
After=network.target postgresql.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/La Mirage
Environment="PATH=/path/to/venv/bin"
ExecStart=/path/to/venv/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Запуск:
```bash
sudo systemctl daemon-reload
sudo systemctl enable lamirage-bot
sudo systemctl start lamirage-bot
sudo systemctl status lamirage-bot
```

## 📊 Администрирование

### Команды администратора (через WhatsApp):

- `/admin` - Статистика салона
- `/dashboard` - Ссылка на дашборд
- `/ok <id>` - Подтвердить запись
- `/no <id>` - Отклонить запись
- `/connect <номер>` - Подключиться к чату клиента
- `/close` - Завершить режим оператора

### Команды клиента:

- `/myinfo` - Просмотр своих данных
- `/update_name <имя>` - Изменить имя
- `оператор` / `админ` / `менеджер` - Связаться с оператором

## 🗄️ Структура базы данных

### Таблица `conversations`
- `user_id` - ID пользователя WhatsApp
- `stage` - Этап разговора
- `history` - История сообщений (JSONB)
- `booking_data` - Данные бронирования (JSONB)
- `client_name` - Имя клиента
- `client_phone` - Телефон клиента
- `is_admin_mode` - Режим оператора
- `admin_chat_id` - ID чата администратора
- `created_at` / `updated_at` - Временные метки

### Таблица `bookings`
- `id` - ID записи
- `user_id` - ID пользователя
- `client_name` - Имя клиента
- `client_phone` - Телефон
- `service` - Услуга
- `master` - Мастер
- `price` - Цена
- `date` - Дата
- `time` - Время
- `duration` - Длительность (минуты)
- `status` - Статус (pending/confirmed/rejected/cancelled)
- `reminder_sent` - Отправлено ли напоминание

### Таблица `clients`
- `phone` - Телефон (PK)
- `name` - Имя
- `user_id` - WhatsApp ID
- `total_visits` - Всего визитов
- `total_spent` - Всего потрачено
- `last_visit` - Последний визит

### Таблица `statistics`
- `master_name` - Имя мастера (PK)
- `total_bookings` - Всего записей
- `confirmed_bookings` - Подтверждено
- `completed_bookings` - Завершено
- `revenue` - Доход

## 🔄 Автоматические задачи

### Очистка сессий
Каждые 15 минут проверяются и очищаются сессии старше 30 минут.

### Напоминания
Каждые 30 минут отправляются напоминания о записях за час до визита.

## 🐛 Отладка

### Логирование
Все логи выводятся в консоль с уровнями:
- `INFO` - Обычная информация
- `WARNING` - Предупреждения
- `ERROR` - Ошибки

### Проверка подключения к БД
```python
import psycopg2
conn = psycopg2.connect("postgresql://localhost:5432/lamiragebeauty")
print("✅ Подключение успешно")
conn.close()
```

### Проверка Vertex AI
```python
from google.cloud import aiplatform
aiplatform.init(project="lamirage", location="us-central1")
print("✅ Vertex AI подключен")
```

## 📝 Различия с JavaScript версией

### Реализовано:
- ✅ Все функции работы с БД
- ✅ Vertex AI интеграция
- ✅ Google Calendar
- ✅ Валидация данных
- ✅ Проверка доступности
- ✅ Управление сессиями
- ✅ Планировщики задач

### Требует дополнительной реализации:
- ⚠️ WhatsApp клиент (требует выбора библиотеки)
- ⚠️ Обработчик сообщений (зависит от WhatsApp библиотеки)
- ⚠️ QR-код авторизация (зависит от WhatsApp библиотеки)

## 🔐 Безопасность

1. **Не коммитьте** файлы с ключами:
   - `vertex_key.json`
   - `credentials.json`
   - `.env`

2. Добавьте в `.gitignore`:
```
vertex_key.json
credentials.json
.env
*.pyc
__pycache__/
.wwebjs_auth/
.wwebjs_cache/
```

3. Используйте переменные окружения для всех секретов

## 🆘 Поддержка

При возникновении проблем:

1. Проверьте логи: `journalctl -u lamirage-bot -f`
2. Проверьте подключение к БД
3. Проверьте валидность ключей Google Cloud
4. Убедитесь что все зависимости установлены

## 📄 Лицензия

Proprietary - La Mirage Beauty

## 👥 Авторы

- Оригинальная JavaScript версия: La Mirage Beauty Team
- Python версия: Перевод с JavaScript

---

**Примечание**: Для полноценной работы требуется настройка WhatsApp клиента. Рекомендуется использовать Twilio API для продакшена.
