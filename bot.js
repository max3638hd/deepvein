// ============================================================
// bot.js — بوت Telegram محدث مع Telegram Stars
// انسخه مباشرة بدون تعديل
// ============================================================

const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const attachStarsPayment = require('./stars-payment'); // ⭐ ربط Stars

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// فعّل نظام Stars الحقيقي (بس سطر واحد!)
attachStarsPayment(bot);

const GAME_URL = process.env.GAME_URL || 'https://max3638hd.github.io/deepvein/';
const BOT_USERNAME = 'nabdbooks_bot';

// ============= /start =============
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const userName = msg.from.first_name || 'لاعب';
  const referrerId = match[1];

  try {
    // تسجيل اللاعب الجديد أو الحالي
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
    
    if (!user) {
      // لاعب جديد
      await supabase.from('users').insert([{
        telegram_id: userId,
        username: userName,
        ore: 0,
        energy: 5000,
        max_energy: 5000,
        total_earned: 0
      }]);

      // معالجة الإحالة
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
          } catch (e) { /* المستخدم أوقف البوت */ }
        }
      }
    }

    bot.sendMessage(chatId,
      `🎮 <b>أهلاً وسهلاً في Deep Vein!</b>\n\n` +
      `⛏️ ابدأ التعدين الآن واحقق أرباح حقيقية!\n\n` +
      `💎 اشتري VIP و ORE بـ Telegram Stars (دفع فوري وآمن 100%)`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎮 لعب الآن', url: `${GAME_URL}?id=${userId}` }],
            [{ text: '⭐ متجر Stars', callback_data: 'shop_stars' }],
            [{ text: '👥 اشرح صديقك', callback_data: 'referral' }],
            [{ text: '📊 إحصائياتي', callback_data: 'stats' }]
          ]
        }
      }
    );
  } catch (e) {
    console.error('Error in /start:', e);
    bot.sendMessage(chatId, '❌ حدث خطأ، حاول لاحقاً');
  }
});

// ============= Callback Queries =============
// ملف stars-payment.js يتكفل بـ كل callback queries (including buy_* و referral و stats)
// في الملف الجديد stars-payment.js ستجد handler واحد لـ callback_query يتكفل بكل الأزرار
// هنا ما نسجل callback_query عشان ما يحصل تضارب

// ============= معالجات دفع Stars (يُتعامل معها في stars-payment.js) =============
// لا تضيف معالجات إضافية هنا — stars-payment.js يتكفل بـ:
// - bot.on('pre_checkout_query')
// - bot.on('successful_payment')

console.log('✅ Bot initialized successfully');

module.exports = bot;
