import { Client, GatewayIntentBits, Partials, Collection, EmbedBuilder, ActivityType } from 'discord.js';
import { handleMusic, handleMusicInteraction } from './music.js';

const OWNER_IDS = (process.env.BOT_OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALLOWED_CHANNEL = process.env.ALLOWED_CHANNEL_ID || null;

export async function startBot() {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.GuildMembers,
        ],
        partials: [Partials.Channel, Partials.Message],
    });

    client.once('clientReady', () => {
        console.log(`[Bot] Logged in as ${client.user.tag}`);
        client.user.setActivity('🎵 Nhạc | !play', { type: ActivityType.Listening });

        setInterval(() => {
            const activities = [
                { name: '🎵 Nhạc | !play', type: ActivityType.Listening },
                { name: `${client.guilds.cache.size} servers`, type: ActivityType.Watching },
                { name: '!help để xem lệnh', type: ActivityType.Playing },
            ];
            const pick = activities[Math.floor(Math.random() * activities.length)];
            client.user.setActivity(pick.name, { type: pick.type });
        }, 60_000);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;
        if (!message.guild) return;

        const content = message.content.trim();
        if (!content.startsWith('!')) return;

        if (ALLOWED_CHANNEL && message.channel.id !== ALLOWED_CHANNEL) {
            const isOwner = OWNER_IDS.includes(message.author.id);
            if (!isOwner) return;
        }

        const args = content.slice(1).split(/\s+/);
        const command = '!' + args[0].toLowerCase();

        if (await handleMusic(message, command, ['', ...args.slice(1)])) return;

        if (command === '!help') {
            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('🎵 Viper Bot — Danh sách lệnh')
                .setDescription('Prefix: `!`')
                .addFields(
                    {
                        name: '🎶 Nhạc',
                        value: [
                            '`!play <tên/link>` — Phát nhạc / Thêm vào queue',
                            '`!skip` / `!s` — Skip bài hiện tại',
                            '`!stop` — Dừng nhạc & xoá queue',
                            '`!pause` / `!resume` — Tạm dừng / Tiếp tục',
                            '`!queue` / `!q` — Xem danh sách phát',
                            '`!np` — Xem bài đang phát',
                            '`!volume <0-200>` — Chỉnh âm lượng',
                            '`!loop` — Loop bài hiện tại',
                            '`!loopqueue` — Loop toàn bộ queue',
                            '`!shuffle` — Trộn queue ngẫu nhiên',
                            '`!remove <số>` — Xoá bài khỏi queue',
                            '`!move <từ> <đến>` — Di chuyển bài trong queue',
                            '`!skipto <số>` — Nhảy đến bài thứ n',
                            '`!join` / `!leave` — Vào / Rời voice',
                        ].join('\n'),
                    },
                    {
                        name: '🛠️ Khác',
                        value: '`!help` — Xem danh sách lệnh này\n`!ping` — Kiểm tra độ trễ',
                    }
                )
                .setFooter({ text: 'Viper Bot • Hỗ trợ: YouTube, Spotify' })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        if (command === '!ping') {
            const sent = await message.reply('🏓 Đang ping...');
            const latency = sent.createdTimestamp - message.createdTimestamp;
            return sent.edit(`🏓 Pong! Latency: **${latency}ms** | API: **${client.ws.ping}ms**`);
        }

        if (command === '!shutdown' || command === '!restart') {
            if (!OWNER_IDS.includes(message.author.id)) return;
            await message.reply('🔄 Đang khởi động lại...');
            process.exit(0);
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (interaction.isButton()) {
            await handleMusicInteraction(interaction).catch(err => {
                console.error('[Bot] Interaction error:', err.message);
                interaction.reply({ content: '❌ Lỗi xử lý!', flags: 64 }).catch(() => {});
            });
        }
    });

    client.on('error', err => console.error('[Client error]', err.message));
    process.on('unhandledRejection', err => console.error('[UnhandledRejection]', err));

    await client.login(process.env.DISCORD_BOT_TOKEN);
}
