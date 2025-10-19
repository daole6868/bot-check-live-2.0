require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

// === FILE DỮ LIỆU ===
const DATA_FILE = path.join(__dirname, 'live_data.json');

// === LOAD & SAVE DATA ===
const loadSafe = file => {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
  try { return JSON.parse(fs.readFileSync(file)); } 
  catch { fs.writeFileSync(file, '{}'); return {}; }
};

let liveData = loadSafe(DATA_FILE);
const saveData = () => fs.writeFileSync(DATA_FILE, JSON.stringify(liveData, null, 2));

// === HELPER ===
const vnTime = t => new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const formatDuration = sec => `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m ${Math.floor(sec%60)}s`;
const todaySessions = sessions => {
  const t0 = new Date(); t0.setHours(0,0,0,0);
  return sessions.filter(s => (s.end ?? Date.now()) >= t0.getTime())
                 .map(s => ({ start: Math.max(s.start, t0.getTime()), end: s.end ?? Date.now() }));
};
const totalTime = sessions => sessions.reduce((a,s) => a + ((s.end ?? Date.now())-s.start)/1000, 0);
const sendChannel = async (chId, msg) => { if (!chId) return; try { const ch = await client.channels.fetch(chId); if (ch?.isTextBased()) await ch.send(msg); } catch {} };

// === LEADERBOARD ===
const genLeaderboard = data => Object.entries(data)
  .map(([uid, sess]) => ({ userId: uid, totalSec: totalTime(todaySessions(sess)) }))
  .filter(e => e.totalSec > 0)
  .sort((a,b) => b.totalSec - a.totalSec);

const formatLeaderboard = (lb, title) => {
  const lines = [`🏆 **${title}** 🏆`];
  lb.forEach((e,i) => lines.push(`${i+1}. <@${e.userId}> - ${formatDuration(e.totalSec)}`));
  return lines.join('\n');
};

// === CRON HÀNG NGÀY ===
const scheduleDailyLeaderboard = () => {
  cron.schedule('0 0 * * *', async () => {
    const lb = genLeaderboard(liveData);
    if (lb.length) await sendChannel(process.env.DAILY_CHANNEL_ID, formatLeaderboard(lb, "Xếp hạng Stream hôm nay"));
    liveData = {}; saveData(); // reset mỗi ngày
  }, { timezone: "Asia/Ho_Chi_Minh" });
};

// === CLIENT DISCORD ===
const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
]});

// === READY ===
client.once('ready', () => {
  console.log(`🤖 Bot đăng nhập: ${client.user.tag}`);
  scheduleDailyLeaderboard();
  sendChannel(process.env.LOG_CHANNEL_ID, "✅ Bot đã khởi động và sẵn sàng!");
});

// === TRACK STREAM + VOICE (gộp) ===
client.on('voiceStateUpdate', async (oldState, newState) => {
  const user = await client.users.fetch(newState.id);
  if (!user || user.bot) return;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;
  const wasStreaming = oldState.streaming ?? false;
  const isStreaming = newState.streaming ?? false;
  const now = Date.now();

  if (!liveData[user.id]) liveData[user.id] = [];

  // --- Bắt đầu stream
  if (!wasStreaming && isStreaming) {
    liveData[user.id].push({ start: now });
    await sendChannel(process.env.LOG_CHANNEL_ID, `🟢 **Bắt đầu stream:** <@${user.id}> lúc ${vnTime(now)}`);
    saveData();
  }

  // --- Kết thúc stream (bao gồm stop stream hoặc rời voice)
  if ((wasStreaming && !isStreaming) || (oldChannel && !newChannel)) {
    const sessions = liveData[user.id];
    if (sessions.length) {
      const last = sessions[sessions.length - 1];
      if (!last.end) last.end = now;
      const duration = Math.floor((last.end - last.start) / 1000);
      const total = totalTime(todaySessions(sessions));

      await sendChannel(process.env.LOG_CHANNEL_ID, 
        `🔴 <@${user.id}> kết thúc stream\n⏱ Thời gian: ${formatDuration(duration)}\n🕒 Tổng hôm nay: ${formatDuration(total)}\n🕛 Thời điểm: ${vnTime(now)}`);

      saveData();
    }
  }
});

// === COMMANDS ===
client.on('messageCreate', async msg => {
  if (msg.author.bot || msg.channel.id !== process.env.COMMAND_CHANNEL_ID) return;

  const args = msg.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  // !time [user]
  if (command === '!time') {
    const user = msg.mentions.users.first() || msg.author;
    const totalSec = totalTime(todaySessions(liveData[user.id] || []));
    msg.reply(`📊 **Thống kê hôm nay của ${user}**\n⏱ Tổng thời gian stream: ${formatDuration(totalSec)}`);
  }

  // !top
  if (command === '!top') {
    const lb = genLeaderboard(liveData);
    msg.reply(formatLeaderboard(lb, "Xếp hạng Stream hôm nay"));
  }
});

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN);
