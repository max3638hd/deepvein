const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const GAME_URL = process.env.GAME_URL || 'https://max3638hd.github.io/deepvein/';
const BOT_USERNAME = 'nabdbooks_bot';

function setupBot(app) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

  bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const userName = msg.from.first_name || 'لاعب';
    const referrerId = match[1];

    try {
      const { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
      
      if (!user) {
        await supabase.from('users').insert([{
          telegram_id: userId,
          username: userName,
          ore: 0,
          energy: 5000,
          max_energy: 5000,
          total_earned: 0
        }]);

        if (referrerId && referrerId !== userId) {
          const { data: referrer } = await supabase.from('users').select('*').eq('telegram_id', referrerId).single();
          if (referrer) {
            await supabase.from('referrals').insert([{
              referrer_id: referrerId,
              referred_id: userId,
              reward: 500
            }]);
            await supabase.from('users').update({ ore: referrer.ore + 500 }).eq('telegram_id', referrerId);
            try {
              bot.sendMessage(referrerId, `🎉 صديق جديد انضم من رابطك! حصلت على 500 ORE`);
            } catch (e) { }
          }
        }
      }

      bot.sendMessage(chatId,
        `🎮 <b>أهلاً في Deep Vein!</b>\n\n⛏️ ابدأ التعدين وحقق أرباح!`,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎮 لعب الآن', web_app: { url: `${GAME_URL}?id=${userId}` } }],
              [{ text: '👥 اشرح صديقك', callback_data: 'referral' }],
              [{ text: '📊 إحصائياتي', callback_data: 'stats' }]
            ]
          }
        }
      );
    } catch (e) {
      console.error('Error in /start:', e);
      bot.sendMessage(chatId, '❌ حدث خطأ');
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const data = query.data;

    try {
      if (data === 'referral') {
        const link = `https://t.me/${BOT_USERNAME}?start=${userId}`;
        bot.sendMessage(chatId,
          `🔗 رابطك:\n<code>${link}</code>\n\n500 ORE لكل صديق`,
          { parse_mode: 'HTML' }
        );
      } else if (data === 'stats') {
        const { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
        if (user) {
          bot.sendMessage(chatId,
            `📊 إحصائياتك:\n⛏️ ORE: ${user.ore}\n💪 الطاقة: ${user.energy}/${user.max_energy}`,
            { parse_mode: 'HTML' }
          );
        }
      }
      bot.answerCallbackQuery(query.id);
    } catch (e) {
      console.error('Callback error:', e);
      bot.answerCallbackQuery(query.id, '❌ خطأ', true);
    }
  });

  console.log('✅ Bot initialized');
  return bot;
}

module.exports = setupBot;
