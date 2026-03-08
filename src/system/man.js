module.exports = {
    name: 'man',
    version: '1.0.0',
    description: 'System manual — browse modules and their commands',
    system: true,

    commands: {
        man: {
            description: 'List all modules, or show commands of a module. Usage: .man [module]',
            execute: async (msg, args, bot) => {
                const prefix = bot.prefix;

                // .man <module> — show commands of a specific module
                if (args.length > 0) {
                    const moduleName = args[0].toLowerCase();
                    const module     = bot.getModule(moduleName);
                    const meta       = bot.getModuleMeta(moduleName);

                    if (!module) {
                        return msg.reply(
                            `❌ Module *${moduleName}* not found.\n` +
                            `Use *${prefix}man* to see all modules.`
                        );
                    }

                    if (!module.commands || !Object.keys(module.commands).length) {
                        return msg.reply(`📦 *${moduleName}* has no commands.`);
                    }

                    const lines = [
                        `📦 *${meta.name}* v${meta.version}`,
                        `${meta.description}\n`
                    ];

                    for (const [cmdName, cmdHandler] of Object.entries(module.commands)) {
                        const desc = (typeof cmdHandler === 'object' && cmdHandler.description)
                        ? cmdHandler.description
                        : bot.commandDescriptions.get(cmdName.toLowerCase()) || 'No description';

                        lines.push(`• *${prefix}${cmdName}* — ${desc}`);
                    }

                    return msg.reply(lines.join('\n'));
                }

                // .man — list all modules grouped by type
                const systemMods = [];
                const userMods   = [];

                for (const [name, meta] of bot.moduleMeta) {
                    const entry = `• *${name}* v${meta.version} — ${meta.description}`;
                    if (meta.system) {
                        systemMods.push(entry);
                    } else {
                        userMods.push(entry);
                    }
                }

                if (!systemMods.length && !userMods.length) {
                    return msg.reply('No modules loaded.');
                }

                const lines = [`📚 *Modules* (prefix: \`${prefix}\`)\n`];

                if (systemMods.length) {
                    lines.push('⚙️ *System*');
                    lines.push(...systemMods);
                }

                if (userMods.length) {
                    if (systemMods.length) lines.push('');
                    lines.push('📦 *Loaded*');
                    lines.push(...userMods);
                }

                lines.push(`\nℹ️ Use *${prefix}man <module>* to see its commands.`);
                return msg.reply(lines.join('\n'));
            }
        }
    }
};
