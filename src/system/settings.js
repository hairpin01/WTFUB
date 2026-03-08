module.exports = {
    name: 'settings',
    version: '1.0.0',
    description: 'Bot settings — prefix and command aliases',

    /**
     * Called once on load. Restores prefix and aliases from cfg.
     * @param {Userbot} bot
     * @param {Config}  cfg
     */
    async init(bot, cfg) {
        // Restore prefix
        const savedPrefix = cfg.get('prefix');
        if (savedPrefix) {
            bot.prefix = savedPrefix;
        }

        // Restore aliases
        const aliases = cfg.get('aliases', {});
        for (const [alias, { command, args: cmdArgs }] of Object.entries(aliases)) {
            this._registerAlias(bot, alias, command, cmdArgs);
        }
    },

    _registerAlias(bot, alias, command, cmdArgs = []) {
        bot.commands.set(alias, {
            description: `Alias → ${bot.prefix}${command}${cmdArgs.length ? ' ' + cmdArgs.join(' ') : ''}`,
                         execute: async (aliasMsg, aliasArgs, aliasBot) => {
                             const target = aliasBot.commands.get(command);
                             if (!target) return aliasMsg.reply(`❌ Alias target *${command}* no longer exists.`);
                             const mergedArgs = [...cmdArgs, ...aliasArgs];
                             if (typeof target.execute === 'function') {
                                 return target.execute(aliasMsg, mergedArgs, aliasBot);
                             }
                             return target(aliasMsg, mergedArgs, aliasBot);
                         }
        });

        bot.commandDescriptions.set(
            alias,
            `Alias → ${bot.prefix}${command}${cmdArgs.length ? ' ' + cmdArgs.join(' ') : ''}`
        );
    },

    commands: {
        setprefix: {
            description: 'Change the command prefix. Usage: .setprefix <prefix>',
            execute: async (msg, args, bot) => {
                if (!args.length) {
                    return msg.reply('Usage: .setprefix <prefix>\nExample: .setprefix !');
                }

                const newPrefix = args[0];
                const oldPrefix = bot.prefix;
                bot.prefix = newPrefix;

                const cfg = bot.getCfg('settings');
                cfg.set('prefix', newPrefix);

                return msg.reply(`✅ Prefix changed: \`${oldPrefix}\` → \`${newPrefix}\``);
            }
        },

        addalias: {
            description: 'Create an alias for a command with optional args. Usage: .addalias <alias> <command> [args...]',
            execute: async (msg, args, bot) => {
                if (args.length < 2) {
                    return msg.reply(
                        'Usage: .addalias <alias> <command> [args...]\n' +
                        'Example: .addalias pp ping'
                    );
                }

                const alias   = args[0].toLowerCase();
                const command = args[1].toLowerCase();
                const cmdArgs = args.slice(2);

                if (!bot.commands.has(command)) {
                    return msg.reply(`❌ Command *${bot.prefix}${command}* not found.`);
                }

                if (bot.commands.has(alias)) {
                    return msg.reply(`❌ *${alias}* is already a command and cannot be used as an alias.`);
                }

                const self = bot.getModule('settings');
                self._registerAlias(bot, alias, command, cmdArgs);

                // Persist
                const cfg     = bot.getCfg('settings');
                const aliases = cfg.get('aliases', {});
                aliases[alias] = { command, args: cmdArgs };
                cfg.set('aliases', aliases);

                return msg.reply(
                    `✅ Alias created: \`${bot.prefix}${alias}\` → \`${bot.prefix}${command}` +
                    `${cmdArgs.length ? ' ' + cmdArgs.join(' ') : ''}\``
                );
            }
        },

        aliases: {
            description: 'Show all registered aliases',
            execute: async (msg, args, bot) => {
                const cfg     = bot.getCfg('settings');
                const aliases = cfg.get('aliases', {});

                if (!Object.keys(aliases).length) {
                    return msg.reply('No aliases registered.\nUse .addalias <alias> <command> [args...]');
                }

                const lines = ['📋 *Aliases*\n'];
                for (const [alias, { command, args: cmdArgs }] of Object.entries(aliases)) {
                    const target = `${bot.prefix}${command}${cmdArgs.length ? ' ' + cmdArgs.join(' ') : ''}`;
                    lines.push(`• \`${bot.prefix}${alias}\` → \`${target}\``);
                }

                return msg.reply(lines.join('\n'));
            }
        },

        delalias: {
            description: 'Delete an alias. Usage: .delalias <alias>',
            execute: async (msg, args, bot) => {
                if (!args.length) {
                    return msg.reply('Usage: .delalias <alias>');
                }

                const alias   = args[0].toLowerCase();
                const cfg     = bot.getCfg('settings');
                const aliases = cfg.get('aliases', {});

                if (!aliases[alias]) {
                    return msg.reply(`❌ Alias \`${alias}\` not found.`);
                }

                delete aliases[alias];
                cfg.set('aliases', aliases);

                bot.commands.delete(alias);
                bot.commandDescriptions.delete(alias);

                return msg.reply(`✅ Alias \`${bot.prefix}${alias}\` deleted.`);
            }
        }
    }
};
