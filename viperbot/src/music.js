import {
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
} from 'discord.js';
import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    demuxProbe,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior,
} from '@discordjs/voice';
import playdl from 'play-dl';
import ytdlCore from '@distube/ytdl-core';
const ytdl = ytdlCore.default ?? ytdlCore;
const createAgent = ytdlCore.createAgent ?? null;

// ── Spotify init ───────────────────────────────────────────────────────────────
if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    playdl.setToken({
        spotify: {
            client_id: process.env.SPOTIFY_CLIENT_ID,
            client_secret: process.env.SPOTIFY_CLIENT_SECRET,
            refresh_token: '',
            market: 'VN',
        },
    }).then(() => console.log('[Music] Spotify token set ✅')).catch(e => console.warn('[Music] Spotify token error:', e.message));
}

// ── YouTube cookie + ytdl agent ────────────────────────────────────────────────
// YOUTUBE_COOKIE = 1 dòng dạng: SID=xxx; SSID=xxx; HSID=xxx; ...
let ytdlAgent = null;
let rawCookieHeader = null;
if (process.env.YOUTUBE_COOKIE) {
    rawCookieHeader = process.env.YOUTUBE_COOKIE.trim();
    playdl.setToken({ youtube: { cookie: rawCookieHeader } });
    if (typeof createAgent === 'function') {
        const cookies = rawCookieHeader.split(';').map(pair => {
            const idx = pair.indexOf('=');
            if (idx === -1) return null;
            return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
        }).filter(Boolean);
        ytdlAgent = createAgent(cookies);
        console.log(`[Music] YouTube cookie set ✅ via agent (${cookies.length} cookies)`);
    } else {
        console.log(`[Music] YouTube cookie set ✅ via header fallback`);
    }
} else {
    console.warn('[Music] YOUTUBE_COOKIE not set');
}

// ── Stream helpers ─────────────────────────────────────────────────────────────
function ytdlCoreStream(url) {
    const opts = {
        filter: 'audioonly',
        quality: 'highestaudio',
        highWaterMark: 1 << 25,
    };
    if (ytdlAgent) {
        opts.agent = ytdlAgent;
    } else if (rawCookieHeader) {
        opts.requestOptions = { headers: { Cookie: rawCookieHeader } };
    }
    const stream = ytdl(url, opts);
    stream.on('error', err => console.error('[ytdl error]', err.message));
    return stream;
}

async function createMusicStream(url) {
    try {
        const s = await playdl.stream(url, { quality: 2, discordPlayerCompatibility: true });
        console.log('[Music] play-dl stream OK, type:', s.type);
        return s.stream;
    } catch (pdErr) {
        console.warn('[Music] play-dl failed:', pdErr.message, '— trying ytdl-core');
    }
    return ytdlCoreStream(url);
}

// ── Queue store ────────────────────────────────────────────────────────────────
const queues = new Map();

function getQueue(guildId) {
    if (!queues.has(guildId)) {
        queues.set(guildId, {
            songs: [], player: null, connection: null,
            loop: false, loopQueue: false, volume: 80,
            textChannel: null, nowPlaying: null,
        });
    }
    return queues.get(guildId);
}

function destroyQueue(guildId) {
    const q = queues.get(guildId);
    if (q) { q.player?.stop(true); q.connection?.destroy(); queues.delete(guildId); }
}

function formatDuration(sec) {
    if (!sec || isNaN(sec)) return '🔴 LIVE';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

function npEmbed(song, q) {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎵 Đang phát nhạc')
        .setDescription(`**[${song.title}](${song.url})**`)
        .setThumbnail(song.thumbnail)
        .addFields(
            { name: '⏱️ Thời lượng', value: formatDuration(song.duration), inline: true },
            { name: '👤 Yêu cầu bởi', value: `<@${song.requestedBy}>`, inline: true },
            { name: '📻 Trạng thái', value: q.loop ? '🔂 Loop bài' : q.loopQueue ? '🔁 Loop queue' : '▶️ Đang phát', inline: true },
            { name: '🎶 Queue', value: q.songs.length > 0 ? `${q.songs.length} bài tiếp` : 'Hết queue', inline: true },
            { name: '🔊 Âm lượng', value: `${q.volume}%`, inline: true },
        ).setTimestamp();
}

function playerRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_prev').setLabel('⏮').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_pause').setLabel('⏸ Tạm dừng').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭ Skip').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹ Stop').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('music_queue').setLabel('📋 Queue').setStyle(ButtonStyle.Secondary),
    );
}

// ── Play next ──────────────────────────────────────────────────────────────────
async function playNext(guildId) {
    const q = queues.get(guildId);
    if (!q) return;
    if (q.songs.length === 0) {
        q.nowPlaying = null;
        q.textChannel?.send({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('✅ Queue đã kết thúc').setDescription('Dùng `!play` để thêm bài mới!').setTimestamp()] }).catch(() => {});
        setTimeout(() => destroyQueue(guildId), 300_000);
        return;
    }
    const song = q.songs.shift();
    q.nowPlaying = song;
    try {
        const [streamResult] = await Promise.all([
            createMusicStream(song.url),
            (async () => {
                if (!q.connection || q.connection.state.status === VoiceConnectionStatus.Ready) return;
                try { await entersState(q.connection, VoiceConnectionStatus.Ready, 30_000); } catch { console.warn('[Music] Voice not Ready, continuing anyway'); }
            })(),
        ]);
        if (!q.connection || q.connection.state.status === VoiceConnectionStatus.Destroyed) return;
        const { stream: probeStream, type: streamType } = await demuxProbe(streamResult);
        const resource = createAudioResource(probeStream, { inputType: streamType, inlineVolume: false });
        q.player.play(resource);
        console.log(`[Music] Playing: ${song.title}`);
        q.textChannel?.send({ embeds: [npEmbed(song, q)], components: [playerRow()] }).catch(() => {});
    } catch (err) {
        console.error('[Music] playNext error:', err.message);
        q.textChannel?.send(`❌ Không thể phát **${song.title}**: ${err.message}`).catch(() => {});
        playNext(guildId);
    }
}

// ── Ensure voice ───────────────────────────────────────────────────────────────
async function ensureVoice(message, q) {
    const vc = message.member?.voice?.channel;
    if (!vc) { message.reply('❌ Bạn cần vào voice channel trước!'); return false; }
    const guildId = message.guild.id;
    q.textChannel = message.channel;
    const destroyed = !q.connection || q.connection.state.status === VoiceConnectionStatus.Destroyed;
    if (destroyed) {
        try { q.connection?.destroy(); } catch {}
        const conn = joinVoiceChannel({ channelId: vc.id, guildId, adapterCreator: message.guild.voiceAdapterCreator, selfDeaf: true });
        conn.on('stateChange', (o, n) => console.log(`[VoiceConn] ${o.status} → ${n.status}`));
        q.connection = conn;
        if (!q.player) {
            const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
            q.player = player;
            player.on(AudioPlayerStatus.Idle, () => {
                const gq = queues.get(guildId);
                if (!gq) return;
                if (gq.loop && gq.nowPlaying) gq.songs.unshift(gq.nowPlaying);
                else if (gq.loopQueue && gq.nowPlaying) gq.songs.push(gq.nowPlaying);
                playNext(guildId);
            });
            player.on('error', err => { console.error('[Music] Player error:', err.message); playNext(guildId); });
        }
        conn.subscribe(q.player);
        conn.on(VoiceConnectionStatus.Disconnected, async () => {
            try { await Promise.race([entersState(conn, VoiceConnectionStatus.Signalling, 5_000), entersState(conn, VoiceConnectionStatus.Connecting, 5_000)]); }
            catch { destroyQueue(guildId); }
        });
    }
    return true;
}

// ── YouTube search ─────────────────────────────────────────────────────────────
async function searchYouTube(query, userId) {
    const results = await playdl.search(query, { source: { youtube: 'video' }, limit: 1 });
    if (!results.length) return null;
    const v = results[0];
    return { title: v.title, url: v.url, duration: v.durationInSec, thumbnail: v.thumbnails?.[0]?.url ?? null, requestedBy: userId };
}

// ── Resolve song ───────────────────────────────────────────────────────────────
async function resolveSong(query, userId) {
    const spValidate = playdl.sp_validate ? (playdl.sp_validate(query) || false) : false;
    if (spValidate === 'artist') return Promise.reject(new Error('Link Spotify Artist không được hỗ trợ!'));
    if (spValidate === 'track') {
        const sp = await playdl.spotify(query);
        const song = await searchYouTube(`${sp.name} ${sp.artists.map(a => a.name).join(' ')}`, userId);
        if (!song) return null;
        song.title = `${sp.name} — ${sp.artists.map(a => a.name).join(', ')}`;
        song.thumbnail = sp.thumbnail?.url ?? song.thumbnail;
        return [song];
    }
    if (spValidate === 'album') {
        const album = await playdl.spotify(query);
        const tracks = album.fetched_tracks?.peek(50) ?? [];
        const songs = await Promise.all(tracks.map(t => searchYouTube(`${t.name} ${t.artists.map(a => a.name).join(' ')}`, userId).then(s => s ? { ...s, title: `${t.name} — ${t.artists.map(a => a.name).join(', ')}` } : null)));
        return songs.filter(Boolean);
    }
    if (spValidate === 'playlist') {
        const pl = await playdl.spotify(query);
        const tracks = pl.fetched_tracks?.peek(100) ?? [];
        const songs = await Promise.all(tracks.map(t => searchYouTube(`${t.name} ${t.artists.map(a => a.name).join(' ')}`, userId).then(s => s ? { ...s, title: `${t.name} — ${t.artists.map(a => a.name).join(', ')}` } : null)));
        return songs.filter(Boolean);
    }
    const ytMatch = query.match(/(https?:\/\/)?(www\.)?(youtube\.com\/watch\?[^\s]+|youtu\.be\/[^\s]+)/);
    if (ytMatch) query = ytMatch[0].startsWith('http') ? ytMatch[0] : 'https://' + ytMatch[0];
    if (playdl.yt_validate(query) === 'video') {
        const r = await playdl.video_info(query);
        const i = r.video_details;
        return [{ title: i.title, url: i.url, duration: i.durationInSec, thumbnail: i.thumbnails?.[0]?.url ?? null, requestedBy: userId }];
    }
    if (playdl.yt_validate(query) === 'playlist') {
        const pl = await playdl.playlist_info(query, { incomplete: true });
        const videos = await pl.all_videos();
        return videos.map(v => ({ title: v.title, url: v.url, duration: v.durationInSec, thumbnail: v.thumbnails?.[0]?.url ?? null, requestedBy: userId }));
    }
    if (query.startsWith('http')) {
        try { const u = new URL(query); query = u.searchParams.get('q') || u.pathname.replace(/[/_-]+/g, ' ').trim(); } catch {}
    }
    const song = await searchYouTube(query, userId);
    return song ? [song] : null;
}

// ── Main handler ───────────────────────────────────────────────────────────────
export async function handleMusic(message, command, args) {
    const MUSIC_COMMANDS = ['!play','!p','!skip','!s','!stop','!queue','!q','!np','!nowplaying','!pause','!resume','!volume','!vol','!loop','!loopqueue','!lq','!shuffle','!remove','!rm','!clearqueue','!cq','!join','!leave','!dc','!move','!skipto'];
    if (!MUSIC_COMMANDS.includes(command)) return false;
    const guildId = message.guild.id;
    const q = getQueue(guildId);
    q.textChannel = message.channel;

    if (command === '!play' || command === '!p') {
        const query = args.slice(1).join(' ');
        if (!query) {
            if (q.player?.state.status === AudioPlayerStatus.Paused) { q.player.unpause(); return message.reply('▶️ Đã tiếp tục phát nhạc!'); }
            return message.reply('❌ VD: `!play <tên bài / URL YouTube>`');
        }
        const ok = await ensureVoice(message, q);
        if (!ok) return;
        const loading = await message.reply('🔍 Đang tìm kiếm...');
        try {
            const songs = await resolveSong(query, message.author.id);
            if (!songs?.length) return loading.edit('❌ Không tìm thấy bài hát!');
            if (songs.length > 1) {
                q.songs.push(...songs);
                await loading.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Đã thêm playlist!').setDescription(`**${songs.length} bài** đã thêm.`).addFields({ name: '🎵 Bài đầu tiên', value: songs[0].title }).setTimestamp()] });
            } else {
                const song = songs[0];
                q.songs.push(song);
                if (q.player?.state.status === AudioPlayerStatus.Playing || q.player?.state.status === AudioPlayerStatus.Buffering) {
                    await loading.edit({ content: null, embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('✅ Đã thêm vào queue').setDescription(`**[${song.title}](${song.url})**`).setThumbnail(song.thumbnail).addFields({ name: '📍 Vị trí', value: `#${q.songs.length}`, inline: true }, { name: '⏱️', value: formatDuration(song.duration), inline: true }).setTimestamp()] });
                } else { await loading.delete().catch(() => {}); }
            }
            if (q.player?.state.status !== AudioPlayerStatus.Playing && q.player?.state.status !== AudioPlayerStatus.Buffering) await playNext(guildId);
        } catch (err) { console.error('[Music] play error:', err); loading.edit(`❌ Lỗi: ${err.message}`).catch(() => {}); }
        return;
    }
    if (command === '!skip' || command === '!s') { if (!q.nowPlaying) return message.reply('❌ Không có bài nào!'); const t = q.nowPlaying.title; q.loop = false; q.player.stop(); return message.reply(`⏭️ Đã skip: **${t}**`); }
    if (command === '!skipto') { const n = parseInt(args[1]); if (isNaN(n)||n<1||n>q.songs.length) return message.reply(`❌ Nhập số 1-${q.songs.length}!`); q.songs.splice(0,n-1); q.loop=false; q.player.stop(); return message.reply(`⏭️ Nhảy đến bài #${n}`); }
    if (command === '!stop') { if (!q.player) return message.reply('❌ Bot chưa phát nhạc!'); q.songs=[]; q.loop=false; q.loopQueue=false; q.player.stop(); destroyQueue(guildId); return message.reply('⏹️ Đã dừng nhạc!'); }
    if (command === '!pause') { if (q.player?.state.status!==AudioPlayerStatus.Playing) return message.reply('❌ Không có gì đang phát!'); q.player.pause(); return message.reply('⏸️ Đã tạm dừng!'); }
    if (command === '!resume') { if (q.player?.state.status!==AudioPlayerStatus.Paused) return message.reply('❌ Nhạc không đang bị dừng!'); q.player.unpause(); return message.reply('▶️ Đã tiếp tục!'); }
    if (command === '!volume' || command === '!vol') { const vol=parseInt(args[1]); if(isNaN(vol)||vol<0||vol>200) return message.reply('❌ VD: `!volume 80` (0-200)'); q.volume=vol; return message.reply(`🔊 Âm lượng: **${vol}%**`); }
    if (command === '!loop') { q.loopQueue=false; q.loop=!q.loop; return message.reply(q.loop?'🔂 Loop bài: **BẬT**':'▶️ Loop bài: **TẮT**'); }
    if (command === '!loopqueue' || command === '!lq') { q.loop=false; q.loopQueue=!q.loopQueue; return message.reply(q.loopQueue?'🔁 Loop queue: **BẬT**':'▶️ Loop queue: **TẮT**'); }
    if (command === '!shuffle') { if(q.songs.length<2) return message.reply('❌ Queue cần ít nhất 2 bài!'); for(let i=q.songs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[q.songs[i],q.songs[j]]=[q.songs[j],q.songs[i]];} return message.reply(`🔀 Đã shuffle **${q.songs.length}** bài!`); }
    if (command === '!remove' || command === '!rm') { const idx=parseInt(args[1])-1; if(isNaN(idx)||idx<0||idx>=q.songs.length) return message.reply(`❌ Nhập số 1-${q.songs.length}!`); const r=q.songs.splice(idx,1)[0]; return message.reply(`🗑️ Đã xoá: **${r.title}**`); }
    if (command === '!clearqueue' || command === '!cq') { q.songs=[]; return message.reply('🗑️ Đã xoá queue!'); }
    if (command === '!move') { const from=parseInt(args[1])-1,to=parseInt(args[2])-1; if(isNaN(from)||isNaN(to)||from<0||to<0||from>=q.songs.length||to>=q.songs.length) return message.reply('❌ VD: `!move <từ> <đến>`'); const [s]=q.songs.splice(from,1); q.songs.splice(to,0,s); return message.reply(`↕️ Di chuyển **${s.title}** → #${to+1}`); }
    if (command === '!np' || command === '!nowplaying') { if (!q.nowPlaying) return message.reply('❌ Không có gì đang phát!'); return message.reply({ embeds: [npEmbed(q.nowPlaying, q)], components: [playerRow()] }); }
    if (command === '!queue' || command === '!q') {
        if (!q.nowPlaying && !q.songs.length) return message.reply('❌ Queue trống!');
        const page=Math.max((parseInt(args[1])||1)-1,0), PER=10, start=page*PER;
        const items=q.songs.slice(start,start+PER), totalPages=Math.ceil(q.songs.length/PER)||1;
        const nowLine=q.nowPlaying?`**🎵 Đang phát:** [${q.nowPlaying.title}](${q.nowPlaying.url}) \`${formatDuration(q.nowPlaying.duration)}\`\n\n`:'';
        const list=items.length?items.map((s,i)=>`\`${start+i+1}.\` [${s.title}](${s.url}) \`${formatDuration(s.duration)}\``).join('\n'):'*Trống*';
        const total=q.songs.reduce((a,s)=>a+(s.duration||0),0);
        return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`📋 Queue — ${message.guild.name}`).setDescription(nowLine+list).addFields({name:'📊 Tổng',value:`${q.songs.length} bài · ${formatDuration(total)}`,inline:true},{name:'🔁 Loop',value:q.loop?'Bài':q.loopQueue?'Queue':'Tắt',inline:true},{name:'🔊 Vol',value:`${q.volume}%`,inline:true}).setFooter({text:`Trang ${page+1}/${totalPages}`}).setTimestamp()] });
    }
    if (command === '!join') { const vc=message.member?.voice?.channel; if(!vc) return message.reply('❌ Vào voice trước!'); await ensureVoice(message,q); return message.reply(`✅ Đã vào **${vc.name}**!`); }
    if (command === '!leave' || command === '!dc') { destroyQueue(guildId); return message.reply('👋 Đã rời voice!'); }
    return false;
}

// ── Button interactions ────────────────────────────────────────────────────────
export async function handleMusicInteraction(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('music_')) return false;
    const q = queues.get(interaction.guild.id);
    if (!q) return interaction.reply({ content: '❌ Không có queue nào!', flags: 64 });
    if (id === 'music_pause') {
        if (q.player?.state.status===AudioPlayerStatus.Playing) { q.player.pause(); await interaction.reply({content:'⏸️ Đã tạm dừng!',flags:64}); }
        else if (q.player?.state.status===AudioPlayerStatus.Paused) { q.player.unpause(); await interaction.reply({content:'▶️ Đã tiếp tục!',flags:64}); }
        else await interaction.reply({content:'❌ Không có gì!',flags:64});
        return true;
    }
    if (id === 'music_skip') { if(!q.nowPlaying) return interaction.reply({content:'❌ Không có bài!',flags:64}); q.loop=false; q.player.stop(); await interaction.reply({content:`⏭️ Skip: **${q.nowPlaying?.title}**`,flags:64}); return true; }
    if (id === 'music_stop') { q.songs=[]; q.loop=false; q.loopQueue=false; q.player?.stop(true); destroyQueue(interaction.guild.id); await interaction.reply({content:'⏹️ Đã dừng!',flags:64}); return true; }
    if (id === 'music_queue') {
        if (!q.nowPlaying&&!q.songs.length) return interaction.reply({content:'❌ Queue trống!',flags:64});
        const list=q.songs.slice(0,10).map((s,i)=>`\`${i+1}.\` ${s.title} \`${formatDuration(s.duration)}\``).join('\n')||'*Trống*';
        await interaction.reply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Queue').setDescription(`**Đang phát:** ${q.nowPlaying?.title||'Không có'}\n\n${list}`).setFooter({text:`${q.songs.length} bài tiếp`})],flags:64});
        return true;
    }
    if (id === 'music_prev') { await interaction.reply({content:'⏮️ Chưa hỗ trợ!',flags:64}); return true; }
    return false;
}
