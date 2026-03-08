const os = require('os');

module.exports = {
    name: 'info',
    version: '1.0.0',
    description: 'Shows userbot information and stats',

    commands: {
        info: {
            description: 'Show userbot info, loaded modules and system stats',
            execute: async (msg, args, bot) => {
                const uptime   = formatUptime(process.uptime());
                const mem      = process.memoryUsage();
                const memUsed  = (mem.rss / 1024 / 1024).toFixed(1);
                const nodeVer  = process.version;
                const platform = `${os.type()} ${os.release()} (${os.arch()})`;

                const systemCount = bot.modules.size;
                const userCount   = bot.modules_loaded.size;
                const cmdCount    = bot.commands.size;

                // List user modules with versions
                const userModules = [...bot.modules_loaded.values()]
                    .map(m => `${m.name} v${m.version || '1.0.0'}`)
                    .join(', ') || 'none';

                const lines = [
                    `🧬 *WTF Userbot*\n`,
                    `🔻 *System*`,
                    `• Node.js: \`${nodeVer}\``,
                    `• Platform: \`${platform}\``,
                    `• Memory: \`${memUsed} MB\``,
                    `• Uptime: \`${uptime}\``,
                    ``,
                    `• Prefix: \`${bot.prefix}\``,
                ];

                return msg.reply(lines.join('\n'));
            }
        }
    }
};

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);

    return parts.join(' ');
}
