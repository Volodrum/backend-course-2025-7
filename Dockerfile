# Використовуємо офіційний образ Node.js
FROM node:18-alpine

# Встановлюємо робочу директорію всередині контейнера
WORKDIR /app

# Копіюємо package.json та package-lock.json (якщо є)
COPY package*.json ./

# Встановлюємо залежності
RUN npm install

# Копіюємо решту коду
COPY . .

# Відкриваємо порт (інформативно)
EXPOSE 3000

# Команда за замовчуванням (використовуємо скрипт dev для nodemon)
CMD ["npm", "run", "dev"]