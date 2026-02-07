// Test script to verify date/time formatting fix
const { formatDateTime } = { 
  formatDateTime: function(date, time, durationMinutes = 60) {
    const timezone = 'Asia/Almaty';
    const timezoneOffset = '+05:00';
    
    const startDateTime = `${date}T${time}:00${timezoneOffset}`;
    const startDateObj = new Date(startDateTime);
    const endDateObj = new Date(startDateObj.getTime() + durationMinutes * 60000);
    
    const endYear = endDateObj.getFullYear();
    const endMonth = String(endDateObj.getMonth() + 1).padStart(2, '0');
    const endDay = String(endDateObj.getDate()).padStart(2, '0');
    const endHours = String(endDateObj.getHours()).padStart(2, '0');
    const endMinutes = String(endDateObj.getMinutes()).padStart(2, '0');
    
    const endDateTime = `${endYear}-${endMonth}-${endDay}T${endHours}:${endMinutes}:00${timezoneOffset}`;
    
    return {
      start: {
        dateTime: startDateTime,
        timeZone: timezone,
      },
      end: {
        dateTime: endDateTime,
        timeZone: timezone,
      },
    };
  }
};

console.log('\n🧪 Тестирование исправления форматирования даты/времени\n');

// Тест с бронированием #11: 8 февраля 2026, 17:00, длительность 120 минут
const result = formatDateTime('2026-02-08', '17:00', 120);

console.log('📅 Входные данные:');
console.log('   Дата: 2026-02-08');
console.log('   Время: 17:00');
console.log('   Длительность: 120 минут');
console.log('');
console.log('✅ Результат (RFC3339):');
console.log('   Start:', result.start.dateTime);
console.log('   End:  ', result.end.dateTime);
console.log('   Timezone:', result.start.timeZone);
console.log('');

// Проверка правильности
const startDate = new Date(result.start.dateTime);
const endDate = new Date(result.end.dateTime);

console.log('🔍 Проверка интерпретации:');
console.log('   Start (parsed):', startDate.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }));
console.log('   End (parsed):  ', endDate.toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }));
console.log('');

const duration = (endDate - startDate) / 60000;
console.log('   Длительность (мин):', duration);
console.log('');

if (startDate.getFullYear() === 2026 &&
    startDate.getMonth() === 1 && // Февраль (0-indexed)
    startDate.getDate() === 8 &&
    startDate.getHours() === 17 &&
    startDate.getMinutes() === 0 &&
    duration === 120) {
  console.log('✅ ТЕСТ ПРОЙДЕН! Дата и время корректны.');
} else {
  console.log('❌ ТЕСТ НЕ ПРОШЁЛ! Обнаружены ошибки.');
}

console.log('');
