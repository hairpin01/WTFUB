module.exports = {
    name: 'ping',
    version: '1.0.0',
    description: 'Check bot response latency',

    commands: {
        ping: {
            description: 'Pong! Shows message delivery latency',
            execute: async (msg, args, bot) => {
                const now = Date.now();
                const sent = msg.timestamp * 1000; // whatsapp-web.js gives seconds
                const latency = now - sent;

                msg.reply(`🏓 Pong! \`${latency}ms\``);
            }
        }
    }
};
