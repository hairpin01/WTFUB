# WTPUB
| [EN](https://github.com/hairpin01/WTFUB/blob/main/README.md) |

WhatsApp Userbot на Node.js с модульной системой команд.

## Возможности

- Модульная система команд
- Системные модули (src/system/)
- Пользовательские модули (src/modules/)
- Конфигурация через JSON
- Логирование
- QR-код авторизация

## Установка

```bash
npm install
```

## Запуск

```bash
node index.js
```

При первом запуске появится QR-код для авторизации в WhatsApp.

## Настройка

Настройки в `config/settings.json`:

- `prefix` - префикс команд (по умолчанию `.`)
- `sessionPath` - путь для сессии
- `modulesPath` - путь к модулям

### Базовые команды

- `.man` - Список всех загруженных модулей
- `.man <модуль>` - Показать команды конкретного модуля

## Команды

Команды вызываются через префикс, например: `.команда`

### Создание модуля

```javascript
module.exports = {
    name: 'mymodule',
    version: '1.0.0',
    description: 'Мой модуль',
    commands: {
        hello: {
            description: 'Приветствие',
            execute: async (msg, args, bot) => {
                await msg.reply('Привет!');
            }
        }
    }
};
```

> [!TIP]
> [Api doc](https://github.com/hairpin01/WTFUB/blob/main/API_DOC.md)

## Структура проекта

```
├── index.js          # Точка входа
├── config/          # Конфигурация
├── src/
│   ├── core/        # Ядро бота
│   ├── modules/    # Пользовательские модули
│   ├── system/     # Системные модули
│   └── lib/        # Утилиты
└── session/         # Сессия WhatsApp
```

## Зависимости

- whatsapp-web.js
- qrcode-terminal
