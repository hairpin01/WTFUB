# WTF Userbot — Module API

## Overview

Modules are plain CommonJS files placed in `src/modules/`. Each file exports a single object that describes the module and its commands. The loader picks up every `.js` file in that directory automatically on startup.

System modules live in `src/system/` and are loaded before user modules. They cannot be unloaded at runtime.

---

## Directory structure

```
src/
  modules/        user modules
  system/         system modules (man, etc.)
config/           per-module persistent config (auto-created)
lib/
  loader/
    modules.js    ModuleLoader
    config.js     Config class
```

---

## Module shape

```js
module.exports = {
    // Required
    name:        'mymodule',        // string — unique module identifier

    // Optional metadata
    version:     '1.0.0',          // string — shown in .man and .info
    description: 'Does something', // string — shown in .man

    // Optional lifecycle hook
    async init(bot, cfg) {
        // called once after the module is loaded
        // restore state, register listeners, etc.
    },

    // Commands exposed to users
    commands: {
        // see "Commands" section below
    }
};
```

All fields except `name` are optional. A module without `commands` is valid (e.g. a module that only hooks into `init`).

---

## Commands

A command can be defined in two ways.

### Simple function

```js
commands: {
    ping: async (msg, args, bot) => {
        await msg.reply('Pong!');
    }
}
```

### Object with description

```js
commands: {
    ping: {
        description: 'Check bot latency. Usage: .ping',
        execute: async (msg, args, bot) => {
            await msg.reply('Pong!');
        }
    }
}
```

The object form is preferred because the description is shown by `.man <module>`.

### Command arguments

| Parameter | Type             | Description                                      |
|-----------|------------------|--------------------------------------------------|
| `msg`     | `Message`        | whatsapp-web.js Message object                   |
| `args`    | `string[]`       | words after the command name, split by whitespace |
| `bot`     | `Userbot`        | the bot instance                                 |

`args` example: for `.echo hello world`, args is `['hello', 'world']`.

---

## Bot API

The `bot` object passed to every command and to `init`.

### Properties

| Property              | Type              | Description                              |
|-----------------------|-------------------|------------------------------------------|
| `bot.prefix`          | `string`          | current command prefix (default `.`)     |
| `bot.client`          | `Client`          | whatsapp-web.js Client instance          |
| `bot.modules`         | `Map`             | system modules                           |
| `bot.modules_loaded`  | `Map`             | user modules                             |
| `bot.commands`        | `Map`             | all registered command handlers          |
| `bot.commandDescriptions` | `Map`         | commandName -> description string        |
| `bot.moduleMeta`      | `Map`             | name/version/description/system per module |

### Methods

```js
bot.getModule(name)              // returns module object or null
bot.getModuleMeta(name)          // returns { name, version, description, system } or null
bot.getCommand(name)             // returns command handler or undefined
bot.getCommandDescription(name)  // returns description string or null
bot.getCfg(moduleName)           // returns Config instance for a module or null

await bot.loadModule(filePath)   // load a module from an absolute path
await bot.unloadModule(name)     // unload a module and remove its commands
```

---

## Config API

Every module automatically receives a `cfg` instance in `init(bot, cfg)`. It is also accessible anywhere via `bot.getCfg('modulename')`.

Data is persisted to `config/<modulename>.json` and survives restarts.

```js
cfg.get(key)                // read a value, returns undefined if missing
cfg.get(key, defaultValue)  // read a value with a fallback
cfg.set(key, value)         // write a value and save to disk immediately
cfg.delete(key)             // remove a key and save
cfg.all()                   // returns a shallow copy of the entire config object
cfg.clear()                 // remove all keys and save
```

All write methods return `cfg` so calls can be chained.

---

## Lifecycle: init

`init(bot, cfg)` is called once right after the module is `require()`-d, before any command can be invoked. Use it to restore persisted state or register anything that should run at startup.

```js
async init(bot, cfg) {
    // restore a counter from disk
    this._count = cfg.get('count', 0);
}
```

If `init` throws, the module fails to load and an error is logged.

---

## Reading replied messages

```js
execute: async (msg, args, bot) => {
    const quoted = await msg.getQuotedMessage().catch(() => null);
    if (!quoted) return msg.reply('Reply to a message.');
    const text = quoted.body;
}
```

---

## Full example

```js
module.exports = {
    name:        'counter',
    version:     '1.0.0',
    description: 'Persistent call counter',

    async init(bot, cfg) {
        this._count = cfg.get('count', 0);
    },

    commands: {
        count: {
            description: 'Show and increment the call counter',
            execute: async (msg, args, bot) => {
                const cfg = bot.getCfg('counter');
                this._count += 1;
                cfg.set('count', this._count);
                await msg.reply(`Count: ${this._count}`);
            }
        },

        countreset: {
            description: 'Reset the counter to zero',
            execute: async (msg, args, bot) => {
                const cfg = bot.getCfg('counter');
                this._count = 0;
                cfg.set('count', 0);
                await msg.reply('Counter reset.');
            }
        }
    }
};
```

---

## Notes

- Command names are case-insensitive. `Ping`, `PING` and `ping` all resolve to the same handler.
- A module cannot register a command name that is already taken by another module. The second module to load wins silently — name your commands carefully.
- System modules (in `src/system/`) cannot be unloaded with `.um`. They are protected.
- `bot.prefix` can change at runtime via `.setprefix`. Always read it from `bot.prefix` rather than hardcoding it.
