// ============================================================
// stars-payment.js
// نظام دفع Telegram Stars — ملف مستقل، ما يلمس bot.js أو server.js الأصليين
// يُستدعى من server.js بسطرين فقط (شوف التعليمات بالأسفل)
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// أسعار حزم VIP والـ ORE بالـ Stars (عدّلها كيف تبي)
const STAR_PACKAGES = {
  vip_bronze: { stars: 150, type: 'vip', level: 'bronze', label: 'VIP Bronze - شهر' },
  vip_gold:   { stars: 300, type: 'vip', level: 'gold',   label: 'VIP Gold - شهر' },
  ore_500:    { stars: 1,  type: 'ore', amount: 500,   label: '500 ORE' },
  ore_2500:   { stars: 5,  type: 'ore', amount: 2500,  label: '2500 ORE' },
  ore_6000:   { stars: 10, type: 'ore', amount: 6000,  label: '6000 ORE' },
};

// هذي الدالة تستقبل الـ bot instance الموجود أصلاً (من bot.js) وتضيف عليه بس
// ما تنشئ بوت جديد، وما تلمس أي handler موجود
function attachStarsPayment(bot) {

  // معالجة كل callback queries: شراء، دعوة، إحصائيات، إلخ
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const data = query.data || '';

    try {
      if (data.startsWith('buy_')) {
        // فاتورة Stars
        const packageId = data.replace('buy_', '');
        const pkg = STAR_PACKAGES[packageId];
        if (!pkg) return;

        await bot.sendInvoice(
          chatId,
          pkg.label,
          `شراء ${pkg.label} في Deep Vein`,
          packageId,
          '',
          'XTR',
          [{ label: pkg.label, amount: pkg.stars }]
        );
      } else if (data === 'shop_stars') {
        // عرض متجر Stars
        bot.sendMessage(chatId,
          `💎 <b>متجر Telegram Stars</b>\n\n✨ اختر ما تبي:`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '500 ORE (1 ⭐)', callback_data: 'buy_ore_500' }],
                [{ text: '2500 ORE (5 ⭐)', callback_data: 'buy_ore_2500' }],
                [{ text: '6000 ORE (10 ⭐)', callback_data: 'buy_ore_6000' }],
                [{ text: '🥉 VIP Bronze (150 ⭐)', callback_data: 'buy_vip_bronze' }],
                [{ text: '🥇 VIP Gold (300 ⭐)', callback_data: 'buy_vip_gold' }]
              ]
            }
          }
        );
      } else if (data === 'referral') {
        // رابط الإحالة
        const link = `https://t.me/nabdbooks_bot?start=${userId}`;
        bot.sendMessage(chatId,
          `🔗 <b>رابطك:</b>\n<code>${link}</code>\n\n500 ORE لكل صديق جديد`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📋 نسخ', callback_data: 'copy_ref' }]]} }
        );
      } else if (data === 'stats') {
        // إحصائيات اللاعب
        const { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).single();
        if (user) {
          bot.sendMessage(chatId,
            `📊 <b>إحصائياتك:</b>\n\n⛏️ ORE: <b>${user.ore}</b>\n💪 الطاقة: <b>${user.energy}/${user.max_energy}</b>\n📈 المستوى: <b>${user.level || 1}</b>`,
            { parse_mode: 'HTML' }
          );
        }
      } else if (data === 'copy_ref') {
        bot.answerCallbackQuery(query.id, '✅ تم النسخ!', false);
        return;
      }

      bot.answerCallbackQuery(query.id);
    } catch (e) {
      console.error('Callback error:', e);
      bot.answerCallbackQuery(query.id, '❌ خطأ', true);
    }
  });

  // موافقة تيليجرام قبل تحصيل الدفع (إلزامي من تيليجرام)
  bot.on('pre_checkout_query', async (query) => {
    await bot.answerPreCheckoutQuery(query.id, true);
  });

  // ✅ هذا الحدث لا يوصل إلا بعد دفع حقيقي مؤكد 100% من تيليجرام
  bot.on('successful_payment', async (msg) => {
    const telegramId = msg.from.id.toString();
    const payment = msg.successful_payment;
    const packageId = payment.invoice_payload;
    const pkg = STAR_PACKAGES[packageId];
    if (!pkg) return;

    // سجل الدفع بدليل الإثبات الحقيقي (charge_id) — للمراجعة لاحقاً لو احتجت
    await supabase.from('vip_purchases').insert({
      telegram_id: telegramId,
      level: pkg.type === 'vip' ? pkg.level : 'ore_pack',
      amount: pkg.stars,
      status: 'completed', // ⭐ فرق عن القديم: هذا يوصل completed مباشرة لأنه دفع حقيقي مؤكد
      payment_proof: payment.telegram_payment_charge_id,
      created_at: new Date()
    });

    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
    if (!user) return;

    if (pkg.type === 'vip') {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
      await supabase.from('users').update({
        vip_level: pkg.level,
        vip_expiry: expiry
      }).eq('telegram_id', telegramId);

      bot.sendMessage(msg.chat.id, `✅ مبروك! تم تفعيل VIP ${pkg.level} تلقائياً لمدة شهر 🎉`);
    } else if (pkg.type === 'ore') {
      await supabase.from('users').update({
        ore: user.ore + pkg.amount,
        total_earned: (user.total_earned || 0) + pkg.amount
      }).eq('telegram_id', telegramId);

      bot.sendMessage(msg.chat.id, `✅ تم! حصلت على ${pkg.amount} ORE 🎉`);
    }
  });

  console.log('✅ Stars payment system attached');
}

module.exports = attachStarsPayment;
