// ============================================================
//  نظام الدفع عبر Telegram Stars (نسخة مستقلة وآمنة)
// ============================================================

module.exports = function(app, supabase) {

  // شراء مميزات باستخدام Stars
  app.post('/api/stars/purchase', async (req, res) => {
    try {
      const { telegramId, item, starsCost } = req.body;

      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

      if (error || !user) {
        return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
      }

      // هنا سيتم إضافة منطق خصم Stars لاحقاً
      res.json({
        success: true,
        message: `✅ تم شراء ${item} بنجاح باستخدام Stars!`,
      });

    } catch (error) {
      console.error('Stars purchase error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // استعلام رصيد Stars
  app.get('/api/stars/balance/:telegramId', async (req, res) => {
    try {
      const { telegramId } = req.params;
      // مؤقتاً نعيد رصيداً وهمياً
      res.json({ success: true, balance: 100 });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  console.log('✅ Stars payment system loaded (standalone)');
};
