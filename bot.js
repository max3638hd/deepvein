const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
// 🔹 استدعاء نظام Stars (ملف منفصل)
const attachStarsPayment = require('./stars-payment');

function setupBot(app) {
  const token = process.env.BOT_TOKEN;
  const gameUrl = process.env.GAME_URL || 'https://max3638hd.github.io/deepvein/';
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  if (!token) {
    console.log('⚠️ BOT_TOKEN not set, Telegram bot disabled');
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

  // 🔹 تفعيل نظام Stars (يضيف أمر /shop وأزرار الدفع)
  attachStarsPayment(bot);

  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);
    const referrerId = match && match[1] ? match[1].trim() : null;

    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('telegram_id', telegramId)
        .maybeSingle();

      if (!existingUser && referrerId && referrerId !== telegramId) {
        await supabase.from('users').insert({
          telegram_id: telegramId,
          username: msg.from.username || `user_${telegramId}`,
          ore: 300,
          energy: 1000,
          level: 1,
          referral_count: 0,
          total_earned: 300,
          last_tap: new Date(),
        });

        const { error: refError } = await supabase.from('referrals').insert({
          referrer_telegram_id: referrerId,
          referred_telegram_id: telegramId,
        });

        if (!refError) {
          const { data: referrer } = await supabase
            .from('users')
            .select('ore, referral_count')
            .eq('telegram_id', referrerId)
            .maybeSingle();

          if (referrer) {
            await supabase
              .from('users')
              .update({
                ore: referrer.ore + 500,
                referral_count: (referrer.referral_count || 0) + 1,
              })
              .eq('telegram_id', referrerId);

            bot.sendMessage(referrerId, '🎉 صديق جديد انضم عن طريق رابطك! +500 ORE').catch(() => {});
          }
        }
      } else if (!existingUser) {
        await supabase.from('users').insert({
          telegram_id: telegramId,
          username: msg.from.username || `user_${telegramId}`,
          ore: 0,
          energy: 1000,
          level: 1,
          referral_count: 0,
          total_earned: 0,
          last_tap: new Date(),
        });
      }

      bot.sendMessage(chatId, '🔥⛏️ أهلاً بك يا ' + (msg.from.first_name || 'صديقنا') + ' في Deep Vein Mine!\n\nالواجهة الاحترافية جاهزة الآن، اضغط الزر أدناه للدخول للعبة بالتبويبات الجديدة.', {
        reply_markup: {
          inline_keyboard: [[{ text: '⛏️ العب الآن', web_app: { url: gameUrl } }]],
        },
      });
    } catch (err) {
      console.error('Bot /start error:', err.message);
      bot.sendMessage(chatId, '⛏️ أهلاً بك! اضغط الزر أدناه للعب.', {
        reply_markup: {
          inline_keyboard: [[{ text: '⛏️ العب الآن', web_app: { url: gameUrl } }]],
        },
      });
    }
  });

  console.log('🤖 Telegram bot polling started');
}

module.exports = setupBot;
