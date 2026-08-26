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

  // زر شراء داخل البوت (اختياري تستدعيه من أي مكان بالبوت الحالي، مثلاً أمر /shop)
  bot.onText(/\/shop/, async (msg) => {
    const chatId = msg.chat.id;
    const rows = Object.entries(STAR_PACKAGES).map(([id, pkg]) => ([
      { text: `${pkg.label} — ${pkg.stars} ⭐`, callback_data: `buy_${id}` }
    ]));
    bot.sendMessage(chatId, '💎 اختر ما تبي تشتريه:', {
      reply_markup: { inline_keyboard: rows }
    });
  });

  // الضغط على أي زر شراء يفتح فاتورة Stars رسمية
  bot.on('callback_query', async (query) => {
    const packageId = query.data?.replace('buy_', '');
    const pkg = STAR_PACKAGES[packageId];
    if (!pkg) return; // مو من أزرارنا، خل باقي الأزرار الثانية تشتغل عادي (bot.js يتكفلها)

    await bot.sendInvoice(
      query.message.chat.id,
      pkg.label,
      `شراء ${pkg.label} في Deep Vein`,
      packageId,      // payload
      '',              // provider_token فاضي = Telegram Stars
      'XTR',
      [{ label: pkg.label, amount: pkg.stars }]
    );
    bot.answerCallbackQuery(query.id);
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
